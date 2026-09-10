targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
param namePrefix string

@allowed(['test', 'prod'])
param environment string

@description('A region outside the primary runtime region. The deployment command must reject a matching primary location.')
param location string = resourceGroup().location

@description('Object ID of the existing Pipeline runtime managed identity allowed to write recovery copies.')
param primaryRuntimePrincipalId string

@minValue(35)
@maxValue(365)
param retentionDays int = 90

param tags object = {
  application: 'pipeline'
  environment: environment
  dataClassification: 'phi'
  managedBy: 'bicep'
  purpose: 'regional-recovery'
}

var suffix = toLower(uniqueString(subscription().subscriptionId, resourceGroup().id, namePrefix, environment, location))
var compactPrefix = toLower(replace(namePrefix, '-', ''))
var storageName = take('${compactPrefix}${environment}drv${suffix}', 24)
var blobContributorRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'ba92f5b4-2d11-453d-a403-e96b0029c9fe')

resource recoveryStorage 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: storageName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_ZRS'
  }
  properties: {
    accessTier: 'Cool'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    isHnsEnabled: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
  }
}

resource recoveryBlobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: recoveryStorage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: retentionDays
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: retentionDays
    }
  }
}

resource recoveryContainers 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = [for containerName in [
  'database-recovery'
  'object-recovery'
  'recovery-evidence'
]: {
  parent: recoveryBlobService
  name: containerName
  properties: {
    publicAccess: 'None'
  }
}]

resource primaryRuntimeBackupRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(recoveryStorage.id, primaryRuntimePrincipalId, blobContributorRole)
  scope: recoveryStorage
  properties: {
    principalId: primaryRuntimePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: blobContributorRole
  }
}

output recoveryStorageAccountName string = recoveryStorage.name
output recoveryStorageAccountId string = recoveryStorage.id
output recoveryLocation string = location
output databaseRecoveryContainer string = 'database-recovery'
output objectRecoveryContainer string = 'object-recovery'
output evidenceContainer string = 'recovery-evidence'
