targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
param namePrefix string

@allowed(['dev', 'test', 'prod'])
param environment string

@description('Explicit database cost/resilience choice. pilot is single-zone and production_ha adds a larger primary, zone-redundant standby, longer backups, and geo-redundant backup.')
@allowed(['pilot', 'production_ha'])
param databaseServiceLevel string

param location string = resourceGroup().location
param postgresAdministratorLogin string

@secure()
param postgresAdministratorPassword string

@description('GitHub repository in owner/repository form. Used only to create the OIDC trust subject.')
param githubRepository string

@description('Exact Git branch allowed to exchange GitHub OIDC tokens for the deployment identity.')
param githubBranch string = 'main'

@description('Address space reserved for Pipeline. Confirm that it does not overlap connected Azure or corporate networks.')
param virtualNetworkAddressPrefix string = '10.40.0.0/16'

@description('Dedicated /23 or larger subnet for the workload-profiles Container Apps environment.')
param containerAppsSubnetPrefix string = '10.40.0.0/23'

@description('Delegated subnet for private Azure Database for PostgreSQL Flexible Server access.')
param postgresSubnetPrefix string = '10.40.2.0/24'

@description('Create the Container Apps environment across availability zones. Confirm regional support before deployment.')
param enableZoneRedundancy bool = environment == 'prod'

@description('Resource IDs of Azure Monitor action groups that receive Pipeline alerts. Empty creates visible alert rules without notification delivery.')
param alertActionGroupResourceIds array = []

@description('Deploy the PHI-safe Pipeline operational alert rules.')
param enableOperationalAlerts bool = true

param tags object = {
  application: 'pipeline'
  environment: environment
  dataClassification: 'phi'
  managedBy: 'bicep'
}

var suffix = toLower(uniqueString(subscription().subscriptionId, resourceGroup().id, namePrefix, environment))
var compactPrefix = toLower(replace(namePrefix, '-', ''))
var storageName = take('${compactPrefix}${environment}${suffix}', 24)
var postgresName = take('${namePrefix}-${environment}-pg-${suffix}', 63)
var keyVaultName = take('${namePrefix}-${environment}-kv-${suffix}', 24)
var databricksAccessConnectorName = take('${namePrefix}-${environment}-dbx-connector-${suffix}', 64)
var logName = take('${namePrefix}-${environment}-logs-${suffix}', 63)
var insightsName = take('${namePrefix}-${environment}-appi-${suffix}', 63)
var documentIntelligenceName = take('${namePrefix}-${environment}-docintel-${suffix}', 64)
var registryName = take('${compactPrefix}${environment}acr${suffix}', 50)
var networkName = take('${namePrefix}-${environment}-vnet-${suffix}', 64)
var containerEnvironmentName = take('${namePrefix}-${environment}-cae-${suffix}', 32)
var runtimeIdentityName = take('${namePrefix}-${environment}-runtime-${suffix}', 128)
var deploymentIdentityName = take('${namePrefix}-${environment}-github-${suffix}', 128)
var postgresPrivateDnsZoneName = 'private.postgres.database.azure.com'
var githubSubject = 'repo:${githubRepository}:ref:refs/heads/${githubBranch}'
var highAvailabilityDatabase = databaseServiceLevel == 'production_ha'

var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')
var keyVaultSecretsUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6')
var acrPullRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
var acrPushRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
var contributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b24988ac-6180-42a0-ab88-20f7382dd24c')
var managedIdentityOperatorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'f1a07417-d97a-45cb-824c-7a7467783830')
var cognitiveServicesUserRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'a97b65f3-24c7-4388-baec-2e87135dc908')

resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: networkName
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [virtualNetworkAddressPrefix]
    }
  }
}

resource containerAppsSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'container-apps'
  properties: {
    addressPrefix: containerAppsSubnetPrefix
    delegations: [
      {
        name: 'container-apps-environment'
        properties: {
          serviceName: 'Microsoft.App/environments'
        }
      }
    ]
  }
}

resource postgresSubnet 'Microsoft.Network/virtualNetworks/subnets@2024-05-01' = {
  parent: virtualNetwork
  name: 'postgres'
  properties: {
    addressPrefix: postgresSubnetPrefix
    delegations: [
      {
        name: 'postgres-flexible-server'
        properties: {
          serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
        }
      }
    ]
  }
}

resource postgresPrivateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: postgresPrivateDnsZoneName
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresPrivateDns
  name: 'pipeline-vnet'
  location: 'global'
  tags: tags
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: virtualNetwork.id
    }
  }
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: runtimeIdentityName
  location: location
  tags: tags
}

resource deploymentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: deploymentIdentityName
  location: location
  tags: tags
}

resource githubFederatedCredential 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: deploymentIdentity
  name: 'github-${replace(githubBranch, '/', '-')}'
  properties: {
    audiences: ['api://AzureADTokenExchange']
    issuer: 'https://token.actions.githubusercontent.com'
    subject: githubSubject
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: environment == 'prod' ? 'Standard_ZRS' : 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    isHnsEnabled: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    sasPolicy: {
      expirationAction: 'Log'
      sasExpirationPeriod: '00.01:00:00'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 14
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 14
    }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = [for containerName in [
  'raw'
  'normalized'
  'ocr'
  'evidence'
  'artifacts'
]: {
  parent: blobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}]

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' = {
  name: postgresName
  location: location
  tags: tags
  sku: {
    name: highAvailabilityDatabase ? 'Standard_D4ds_v5' : 'Standard_D2ds_v5'
    tier: 'GeneralPurpose'
  }
  properties: {
    administratorLogin: postgresAdministratorLogin
    administratorLoginPassword: postgresAdministratorPassword
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Enabled'
    }
    backup: {
      backupRetentionDays: highAvailabilityDatabase ? 35 : 14
      geoRedundantBackup: highAvailabilityDatabase ? 'Enabled' : 'Disabled'
    }
    createMode: 'Create'
    highAvailability: {
      mode: highAvailabilityDatabase ? 'ZoneRedundant' : 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: postgresSubnet.id
      privateDnsZoneArmResourceId: postgresPrivateDns.id
      publicNetworkAccess: 'Disabled'
    }
    storage: {
      storageSizeGB: highAvailabilityDatabase ? 256 : 128
      autoGrow: 'Enabled'
    }
    version: '16'
  }
  dependsOn: [postgresDnsLink]
}

resource pipelineDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2025-08-01' = {
  parent: postgres
  name: 'pipeline'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2025-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: {
    source: 'user-override'
    value: 'PGCRYPTO,PG_TRGM'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: subscription().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: environment == 'prod'
    enableSoftDelete: true
    publicNetworkAccess: 'Enabled'
    softDeleteRetentionInDays: 90
  }
}

resource documentIntelligence 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: documentIntelligenceName
  location: location
  tags: tags
  kind: 'FormRecognizer'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: documentIntelligenceName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource databricksAccessConnector 'Microsoft.Databricks/accessConnectors@2023-05-01' = {
  name: databricksAccessConnectorName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {}
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logName
  location: location
  tags: tags
  properties: {
    retentionInDays: environment == 'prod' ? 90 : 30
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: insightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
    DisableLocalAuth: true
    IngestionMode: 'LogAnalytics'
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Standard'
  }
  properties: {
    adminUserEnabled: false
    dataEndpointEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: containerEnvironmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logWorkspace.properties.customerId
        sharedKey: logWorkspace.listKeys().primarySharedKey
      }
    }
    peerAuthentication: {
      mtls: {
        enabled: true
      }
    }
    peerTrafficConfiguration: {
      encryption: {
        enabled: true
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: containerAppsSubnet.id
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: enableZoneRedundancy
  }
}

resource storageRuntimeRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, runtimeIdentity.id, blobContributorRole)
  scope: storage
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

resource storageDatabricksRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storage.id, databricksAccessConnector.id, blobContributorRole)
  scope: storage
  properties: {
    principalId: databricksAccessConnector.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

resource documentIntelligenceDatabricksRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(documentIntelligence.id, databricksAccessConnector.id, cognitiveServicesUserRole)
  scope: documentIntelligence
  properties: {
    principalId: databricksAccessConnector.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: cognitiveServicesUserRole
  }
}

resource keyVaultRuntimeRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, runtimeIdentity.id, keyVaultSecretsUserRole)
  scope: keyVault
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: keyVaultSecretsUserRole
  }
}

resource registryRuntimePullRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, runtimeIdentity.id, acrPullRole)
  scope: registry
  properties: {
    principalId: runtimeIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPullRole
  }
}

resource registryDeploymentPushRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, deploymentIdentity.id, acrPushRole)
  scope: registry
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: acrPushRole
  }
}

resource deploymentContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deploymentIdentity.id, contributorRole)
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: contributorRole
  }
}

resource deploymentIdentityOperatorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(runtimeIdentity.id, deploymentIdentity.id, managedIdentityOperatorRole)
  scope: runtimeIdentity
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: managedIdentityOperatorRole
  }
}

module operationalAlerts 'operational-alerts.bicep' = {
  name: 'pipeline-operational-alerts'
  params: {
    namePrefix: namePrefix
    environment: environment
    location: location
    logAnalyticsWorkspaceId: logWorkspace.id
    postgresServerId: postgres.id
    storageAccountId: storage.id
    actionGroupResourceIds: alertActionGroupResourceIds
    enabled: enableOperationalAlerts
  }
}

output storageAccountName string = storage.name
output namePrefix string = namePrefix
output environment string = environment
output databaseServiceLevel string = databaseServiceLevel
output location string = location
output postgresHost string = postgres.properties.fullyQualifiedDomainName
output postgresAdministratorLogin string = postgresAdministratorLogin
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output databricksAccessConnectorId string = databricksAccessConnector.id
output databricksAccessConnectorPrincipalId string = databricksAccessConnector.identity.principalId
output documentIntelligenceEndpoint string = documentIntelligence.properties.endpoint
output applicationInsightsName string = applicationInsights.name
output logAnalyticsWorkspaceId string = logWorkspace.id
output containerRegistryName string = registry.name
output containerRegistryLoginServer string = registry.properties.loginServer
output containerAppsEnvironmentName string = containerEnvironment.name
output containerAppsEnvironmentId string = containerEnvironment.id
output runtimeIdentityName string = runtimeIdentity.name
output runtimeIdentityResourceId string = runtimeIdentity.id
output runtimeIdentityClientId string = runtimeIdentity.properties.clientId
output githubDeploymentIdentityName string = deploymentIdentity.name
output githubDeploymentClientId string = deploymentIdentity.properties.clientId
output githubFederatedSubject string = githubSubject
output tenantId string = subscription().tenantId
output subscriptionId string = subscription().subscriptionId
output operationalAlertRuleCount int = operationalAlerts.outputs.alertRuleCount
output alertActionGroupResourceIds array = alertActionGroupResourceIds
