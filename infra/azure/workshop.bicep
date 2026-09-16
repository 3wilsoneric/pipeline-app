targetScope = 'resourceGroup'

param location string = resourceGroup().location
param containerAppsEnvironmentName string
param containerRegistryName string
param containerImage string
param deploymentId string
param entraTenantId string
param entraClientId string
// First deployment stays private until the required-auth child resource has
// been verified. Expose ingress only in a second, authenticated rollout.
param publicIngress bool = false
@secure()
param entraClientSecret string

var appName = 'pipeline-workshop-web'

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-07-01' existing = {
  name: containerAppsEnvironmentName
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: containerRegistryName
}

// This identity can pull the image only. It has no production database,
// storage, Key Vault, mail, or clinical integration permissions.
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'pipeline-workshop-pull'
  location: location
}

resource registryPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, identity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

resource workshop 'Microsoft.App/containerApps@2025-07-01' = {
  name: appName
  location: location
  tags: {
    application: 'Pipeline Assessor Workshop'
    data: 'synthetic-only-ephemeral'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${identity.id}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 3
      ingress: {
        external: publicIngress
        allowInsecure: false
        targetPort: 3000
        transport: 'http'
        traffic: [{ latestRevision: true, weight: 100 }]
      }
      registries: [{ server: registry.properties.loginServer, identity: identity.id }]
      secrets: [{ name: 'workshop-entra-secret', value: entraClientSecret }]
    }
    template: {
      revisionSuffix: take(deploymentId, 16)
      terminationGracePeriodSeconds: 30
      containers: [{
        name: 'workshop'
        image: containerImage
        env: [
          { name: 'PORT', value: '3000' }
          { name: 'WORKSHOP_HEALTH_PORT', value: '3001' }
          { name: 'WORKSHOP_PUBLIC_ORIGIN', value: 'https://${appName}.${containerEnvironment.properties.defaultDomain}' }
          { name: 'WORKSHOP_TENANT_ID', value: entraTenantId }
          { name: 'WORKSHOP_MAX_SESSIONS', value: '6' }
          { name: 'WORKSHOP_IDLE_MINUTES', value: '120' }
        ]
        resources: { cpu: json('2.0'), memory: '4Gi' }
        probes: [for kind in ['Liveness', 'Readiness']: {
          type: kind
          httpGet: { path: '/healthz', port: 3001, scheme: 'HTTP' }
          initialDelaySeconds: 10
          periodSeconds: 15
          timeoutSeconds: 5
          failureThreshold: 4
        }]
      }]
      // Processes and temporary practice records are local to this replica.
      // Scaling beyond this ceiling requires a session-routing/storage design.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
  dependsOn: [registryPull]
}

resource authentication 'Microsoft.App/containerApps/authConfigs@2025-07-01' = {
  parent: workshop
  name: 'current'
  properties: {
    platform: { enabled: true }
    globalValidation: {
      unauthenticatedClientAction: 'RedirectToLoginPage'
      redirectToProvider: 'azureActiveDirectory'
    }
    httpSettings: { requireHttps: true }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        // Reuse Pipeline's existing organization-approved API consent instead
        // of asking participants for a new Microsoft Graph consent grant.
        login: { loginParameters: ['scope=openid profile email api://${entraClientId}/access_as_user'] }
        registration: {
          clientId: entraClientId
          clientSecretSettingName: 'workshop-entra-secret'
          openIdIssuer: '${environment().authentication.loginEndpoint}${entraTenantId}/v2.0'
        }
        validation: { allowedAudiences: [entraClientId, 'api://${entraClientId}'] }
      }
    }
    login: {
      allowedExternalRedirectUrls: ['https://${appName}.${containerEnvironment.properties.defaultDomain}']
      cookieExpiration: { convention: 'FixedTime', timeToExpiration: '08:00:00' }
      tokenStore: { enabled: false }
    }
  }
}

output workshopUrl string = 'https://${workshop.properties.configuration.ingress.fqdn}/training/demo?journey=1'
output image string = containerImage
