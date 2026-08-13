targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
param namePrefix string

@allowed(['dev', 'test', 'prod'])
param environment string

@allowed(['pilot', 'production_ha'])
param databaseServiceLevel string

param location string = resourceGroup().location
param postgresAdministratorLogin string
param githubRepository string
param githubBranch string = 'main'

var suffix = toLower(uniqueString(subscription().subscriptionId, resourceGroup().id, namePrefix, environment))
var compactPrefix = toLower(replace(namePrefix, '-', ''))
var storageName = take('${compactPrefix}${environment}${suffix}', 24)
var postgresName = take('${namePrefix}-${environment}-pg-${suffix}', 63)
var keyVaultName = take('${namePrefix}-${environment}-kv-${suffix}', 24)
var databricksAccessConnectorName = take('${namePrefix}-${environment}-dbx-connector-${suffix}', 64)
var logName = take('${namePrefix}-${environment}-logs-${suffix}', 63)
var documentIntelligenceName = take('${namePrefix}-${environment}-docintel-${suffix}', 64)
var registryName = take('${compactPrefix}${environment}acr${suffix}', 50)
var containerEnvironmentName = take('${namePrefix}-${environment}-cae-${suffix}', 32)
var runtimeIdentityName = take('${namePrefix}-${environment}-runtime-${suffix}', 128)
var deploymentIdentityName = take('${namePrefix}-${environment}-github-${suffix}', 128)
var githubSubject = 'repo:${githubRepository}:ref:refs/heads/${githubBranch}'

resource storage 'Microsoft.Storage/storageAccounts@2025-01-01' existing = {
  name: storageName
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2025-08-01' existing = {
  name: postgresName
}

resource keyVault 'Microsoft.KeyVault/vaults@2024-11-01' existing = {
  name: keyVaultName
}

resource databricksAccessConnector 'Microsoft.Databricks/accessConnectors@2023-05-01' existing = {
  name: databricksAccessConnectorName
}

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logName
}

resource documentIntelligence 'Microsoft.CognitiveServices/accounts@2024-10-01' existing = {
  name: documentIntelligenceName
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: registryName
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: containerEnvironmentName
}

resource runtimeIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: runtimeIdentityName
}

resource deploymentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: deploymentIdentityName
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
