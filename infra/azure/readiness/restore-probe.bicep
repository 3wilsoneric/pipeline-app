targetScope = 'resourceGroup'

param containerImage string
param environmentId string
param identityId string
param registryServer string
param databaseSecretUrl string
@allowed(['pipeline-readiness-drill-20260919.postgres.database.azure.com'])
param restoredHost string

resource probe 'Microsoft.App/jobs@2025-01-01' = {
  name: 'pipeline-readiness-restore-probe'
  location: resourceGroup().location
  tags: {
    application: 'pipeline'
    purpose: 'read-only-restore-drill'
    runId: 'readiness-20260919'
    expiresAfter: '2026-09-20T19:10:00Z'
  }
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identityId}': {} }
  }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 180
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: [{ server: registryServer, identity: identityId }]
      secrets: [{ name: 'source-db', keyVaultUrl: databaseSecretUrl, identity: identityId }]
    }
    template: {
      containers: [{
        name: 'probe'
        image: containerImage
        command: ['node']
        args: ['-e', loadTextContent('restore-probe.cjs')]
        env: [
          { name: 'SOURCE_DATABASE_URL', secretRef: 'source-db' }
          { name: 'RESTORED_HOST', value: restoredHost }
        ]
        resources: { cpu: json('0.5'), memory: '1Gi' }
      }]
    }
  }
}

output jobName string = probe.name
