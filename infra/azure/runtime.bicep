targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
param namePrefix string

@allowed(['dev', 'test', 'prod'])
param environment string

param location string = resourceGroup().location
param containerImage string
param deploymentId string
param containerAppsEnvironmentId string
param containerRegistryLoginServer string
param runtimeIdentityResourceId string
param runtimeIdentityClientId string
param keyVaultUri string
param storageAccountName string
param entraTenantId string
param pipelineEntraClientId string
@description('Existing custom hostname bindings that must survive immutable runtime revisions.')
param customDomains array = []
param databricksHost string = ''
param databricksJobId string = ''
param databricksClientId string = ''

@allowed(['manual', 'azure_databricks'])
param extractionBackend string = 'manual'

@allowed(['disconnected', 'alamo_api'])
param clinicalDataMode string = 'disconnected'

param alamoApiBaseUrl string = 'https://www.alamoplatform.com'
param alamoTenantId string = ''
param alamoClientId string = ''
param alamoApiScope string = ''

@description('Enable the metered daily clinical reconciliation job only after explicit approval.')
param enableClinicalReconcileJob bool = false

@minValue(0)
@maxValue(3)
param minimumReplicas int = environment == 'prod' ? 1 : 0

@minValue(1)
@maxValue(10)
param maximumReplicas int = environment == 'prod' ? 3 : 1

@description('Retention is intentionally disabled until the written retention policy and a restore drill are approved.')
param enableRetentionJob bool = false

@description('Create the privileged one-time database bootstrap job. Enable only for the first deployment, then remove it and its administrator secret.')
param initialDatabaseBootstrap bool = false

param tags object = {
  application: 'pipeline'
  environment: environment
  dataClassification: 'phi'
  managedBy: 'bicep'
}

var webName = take('${namePrefix}-${environment}-web', 32)
var databaseBootstrapJobName = take('${namePrefix}-${environment}-database-bootstrap', 32)
var databaseMigrationJobName = take('${namePrefix}-${environment}-database-migrate', 32)
var revisionSuffix = take(toLower(replace(deploymentId, '-', '')), 16)
// The app registration requests v2 access tokens. Their aud claim is the API
// client ID GUID, while the delegated scope retains the api:// URI prefix.
var pipelineApiAudience = pipelineEntraClientId
var pipelineApiScope = 'api://${pipelineEntraClientId}/access_as_user'
var allowedMutationOrigins = join(map(customDomains, domain => 'https://${domain.name}'), ',')
var keyVaultBaseUri = endsWith(keyVaultUri, '/') ? keyVaultUri : '${keyVaultUri}/'
var keyVaultSecretIdentity = runtimeIdentityResourceId

var requiredSecrets = [
  {
    name: 'database-url'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-database-url'
    identity: keyVaultSecretIdentity
  }
  {
    name: 'entra-session-secret'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-entra-session-secret'
    identity: keyVaultSecretIdentity
  }
  {
    name: 'worker-shared-secret'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-worker-shared-secret'
    identity: keyVaultSecretIdentity
  }
]

var databricksSecrets = extractionBackend == 'azure_databricks' ? [
  {
    name: 'databricks-client-secret'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-databricks-client-secret'
    identity: keyVaultSecretIdentity
  }
] : []

var databaseBootstrapSecrets = [
  {
    name: 'database-admin-url'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-database-admin-url'
    identity: keyVaultSecretIdentity
  }
  {
    name: 'database-migration-url'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-database-migration-url'
    identity: keyVaultSecretIdentity
  }
  {
    name: 'database-url'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-database-url'
    identity: keyVaultSecretIdentity
  }
]

var databaseMigrationSecrets = [
  {
    name: 'database-migration-url'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-database-migration-url'
    identity: keyVaultSecretIdentity
  }
]

var clinicalSecrets = clinicalDataMode == 'alamo_api' ? [
  {
    name: 'alamo-client-secret'
    keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-alamo-client-secret'
    identity: keyVaultSecretIdentity
  }
] : []

var baseEnvironment = [
  { name: 'PIPELINE_DEPLOYMENT_ENV', value: environment }
  { name: 'PIPELINE_DATABASE_MODE', value: 'postgres' }
  { name: 'PIPELINE_DATABASE_URL', secretRef: 'database-url' }
  { name: 'PIPELINE_DATABASE_SSL_MODE', value: 'require' }
  { name: 'PIPELINE_DATABASE_POOL_MAX', value: '10' }
  { name: 'PIPELINE_DATABASE_CONNECT_TIMEOUT_SECONDS', value: '10' }
  { name: 'PIPELINE_DATABASE_IDLE_TIMEOUT_SECONDS', value: '20' }
  { name: 'PIPELINE_DATABASE_MAX_LIFETIME_SECONDS', value: '1800' }
  { name: 'PIPELINE_REFERRAL_STORE_MODE', value: 'postgres' }
  { name: 'PIPELINE_ASSESSMENT_STORE_MODE', value: 'postgres' }
  { name: 'PIPELINE_RESIDENT_LINK_STORE_MODE', value: 'postgres' }
  { name: 'PIPELINE_DESKTOP_STATE_ENABLED', value: 'true' }
  { name: 'NEXT_PUBLIC_PIPELINE_DESKTOP_ENABLED', value: 'true' }
  { name: 'PIPELINE_ALLOW_LOCAL_DESKTOP_STATE_STORE', value: 'false' }
  { name: 'PIPELINE_AUTH_MODE', value: 'entra_jwt' }
  { name: 'PIPELINE_ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'PIPELINE_ENTRA_API_AUDIENCE', value: pipelineApiAudience }
  { name: 'PIPELINE_ENTRA_API_SCOPE', value: 'access_as_user' }
  { name: 'NEXT_PUBLIC_ENTRA_TENANT_ID', value: entraTenantId }
  { name: 'NEXT_PUBLIC_ENTRA_CLIENT_ID', value: pipelineEntraClientId }
  { name: 'NEXT_PUBLIC_PIPELINE_API_SCOPE', value: pipelineApiScope }
  { name: 'NEXT_PUBLIC_PIPELINE_AUTH_REQUIRED', value: 'true' }
  { name: 'PIPELINE_ENTRA_SESSION_SECRET', secretRef: 'entra-session-secret' }
  { name: 'PIPELINE_ALLOWED_MUTATION_ORIGINS', value: allowedMutationOrigins }
  { name: 'PIPELINE_TRUSTED_GATEWAY', value: 'false' }
  { name: 'PIPELINE_ALLOW_UNVERIFIED_AUTH_HEADERS', value: 'false' }
  { name: 'PIPELINE_ALLOW_PRODUCTION_MOCK_AUTH', value: 'false' }
  { name: 'PIPELINE_EXTRACTION_BACKEND', value: extractionBackend }
  { name: 'PIPELINE_ALLOW_PRODUCTION_MOCK_EXTRACTION', value: 'false' }
  { name: 'PIPELINE_AZURE_BLOB_AUTH_MODE', value: 'managed_identity' }
  { name: 'AZURE_CLIENT_ID', value: runtimeIdentityClientId }
  { name: 'AZURE_STORAGE_ACCOUNT', value: storageAccountName }
  { name: 'AZURE_STORAGE_CONTAINER_RAW', value: 'raw' }
  { name: 'AZURE_STORAGE_CONTAINER_NORMALIZED', value: 'normalized' }
  { name: 'AZURE_STORAGE_CONTAINER_OCR', value: 'ocr' }
  { name: 'AZURE_STORAGE_CONTAINER_EVIDENCE', value: 'evidence' }
  { name: 'AZURE_STORAGE_CONTAINER_ARTIFACTS', value: 'artifacts' }
  { name: 'PIPELINE_UPLOAD_URL_TTL_SECONDS', value: '900' }
  { name: 'PIPELINE_PREVIEW_MAX_BYTES', value: '26214400' }
  { name: 'PIPELINE_WORKER_SHARED_SECRET', secretRef: 'worker-shared-secret' }
  { name: 'CRON_SECRET', secretRef: 'worker-shared-secret' }
  { name: 'PIPELINE_CLINICAL_DATA_MODE', value: clinicalDataMode }
  { name: 'PIPELINE_CLINICAL_DATA_REQUIRED', value: clinicalDataMode == 'alamo_api' ? 'true' : 'false' }
  { name: 'PIPELINE_CLIENT_HISTORY_MODE', value: 'disconnected' }
  { name: 'PIPELINE_CLINICAL_TIMEOUT_MS', value: '10000' }
  { name: 'PIPELINE_CLINICAL_MAX_RESPONSE_BYTES', value: '2097152' }
  { name: 'PIPELINE_MAX_CONCURRENT_READS', value: '100' }
  { name: 'PIPELINE_MAX_CONCURRENT_MUTATIONS', value: '40' }
  { name: 'PIPELINE_MAX_CONCURRENT_UPLOADS', value: '4' }
  { name: 'PIPELINE_MAX_CONCURRENT_WORKERS', value: '8' }
]

var databricksEnvironment = extractionBackend == 'azure_databricks' ? [
  { name: 'DATABRICKS_HOST', value: databricksHost }
  { name: 'DATABRICKS_JOB_ID', value: databricksJobId }
  { name: 'PIPELINE_DATABRICKS_AUTH_MODE', value: 'oauth_m2m' }
  { name: 'DATABRICKS_CLIENT_ID', value: databricksClientId }
  { name: 'DATABRICKS_CLIENT_SECRET', secretRef: 'databricks-client-secret' }
  { name: 'PIPELINE_DATABRICKS_TIMEOUT_MS', value: '10000' }
  { name: 'PIPELINE_DATABRICKS_MAX_RESPONSE_BYTES', value: '1048576' }
] : []

var clinicalEnvironment = clinicalDataMode == 'alamo_api' ? [
  { name: 'PIPELINE_ALAMO_API_BASE_URL', value: alamoApiBaseUrl }
  { name: 'PIPELINE_ALAMO_AUTH_MODE', value: 'client_credentials' }
  { name: 'PIPELINE_ALAMO_TENANT_ID', value: alamoTenantId }
  { name: 'PIPELINE_ALAMO_CLIENT_ID', value: alamoClientId }
  { name: 'PIPELINE_ALAMO_CLIENT_SECRET', secretRef: 'alamo-client-secret' }
  { name: 'PIPELINE_ALAMO_API_SCOPE', value: alamoApiScope }
] : []

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: last(split(containerAppsEnvironmentId, '/'))
}

resource web 'Microsoft.App/containerApps@2025-01-01' = {
  name: webName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      maxInactiveRevisions: 10
      ingress: {
        allowInsecure: false
        customDomains: customDomains
        external: true
        targetPort: 3000
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: runtimeIdentityResourceId
        }
      ]
      secrets: concat(requiredSecrets, databricksSecrets, clinicalSecrets)
    }
    template: {
      revisionSuffix: revisionSuffix
      terminationGracePeriodSeconds: 30
      containers: [
        {
          name: 'pipeline-web'
          image: containerImage
          env: concat(baseEnvironment, databricksEnvironment, clinicalEnvironment)
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/api/health/live'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 15
              periodSeconds: 30
              timeoutSeconds: 5
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/api/health'
                port: 3000
                scheme: 'HTTP'
              }
              initialDelaySeconds: 10
              periodSeconds: 15
              timeoutSeconds: 5
              failureThreshold: 4
            }
          ]
        }
      ]
      scale: {
        minReplicas: minimumReplicas
        maxReplicas: maximumReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

resource databaseBootstrapJob 'Microsoft.App/jobs@2025-01-01' = if (initialDatabaseBootstrap) {
  name: databaseBootstrapJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: runtimeIdentityResourceId
        }
      ]
      secrets: databaseBootstrapSecrets
    }
    template: {
      containers: [
        {
          name: 'database-bootstrap'
          image: containerImage
          command: ['node']
          args: ['scripts/bootstrap-production-database.mjs']
          env: [
            { name: 'PIPELINE_DATABASE_ADMIN_URL', secretRef: 'database-admin-url' }
            { name: 'PIPELINE_DATABASE_MIGRATION_URL', secretRef: 'database-migration-url' }
            { name: 'PIPELINE_DATABASE_URL', secretRef: 'database-url' }
            { name: 'PIPELINE_DATABASE_SSL_MODE', value: 'require' }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

resource databaseMigrationJob 'Microsoft.App/jobs@2025-01-01' = {
  name: databaseMigrationJobName
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: runtimeIdentityResourceId
        }
      ]
      secrets: databaseMigrationSecrets
    }
    template: {
      containers: [
        {
          name: 'database-migrate'
          image: containerImage
          command: ['node']
          args: ['scripts/apply-database-migrations.mjs']
          env: [
            { name: 'PIPELINE_DATABASE_URL', secretRef: 'database-migration-url' }
            { name: 'PIPELINE_DATABASE_SSL_MODE', value: 'require' }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

var scheduledJobs = [
  {
    name: 'extraction-dispatch'
    schedule: '* * * * *'
    path: '/api/internal/extraction/dispatch'
    enabled: extractionBackend == 'azure_databricks'
  }
  {
    name: 'extraction-reconcile'
    schedule: '*/5 * * * *'
    path: '/api/internal/extraction/reconcile'
    enabled: extractionBackend == 'azure_databricks'
  }
  {
    name: 'clinical-reconcile'
    schedule: '15 13 * * *'
    path: '/api/internal/clinical/reconcile'
    enabled: clinicalDataMode == 'alamo_api' && enableClinicalReconcileJob
  }
  {
    name: 'retention'
    schedule: '17 3 * * *'
    path: '/api/internal/retention?execute=true'
    enabled: enableRetentionJob
  }
]

var jobRunner = '''
const target = process.env.PIPELINE_JOB_URL;
const token = process.env.PIPELINE_WORKER_SHARED_SECRET;
if (!target || !token) process.exit(2);
try {
  const response = await fetch(target, {
    headers: { authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(55000)
  });
  if (!response.ok) {
    console.error(JSON.stringify({ level: 'error', service: 'pipeline-job', msg: 'job_request_failed', status: response.status }));
    process.exit(1);
  }
  console.log(JSON.stringify({ level: 'info', service: 'pipeline-job', msg: 'job_request_complete', status: response.status }));
} catch {
  console.error(JSON.stringify({ level: 'error', service: 'pipeline-job', msg: 'job_request_unavailable' }));
  process.exit(1);
}
'''

resource jobs 'Microsoft.App/jobs@2025-01-01' = [for job in scheduledJobs: if (job.enabled) {
  name: take('${namePrefix}-${environment}-${job.name}', 32)
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityResourceId}': {}
    }
  }
  properties: {
    environmentId: containerEnvironment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 90
      replicaRetryLimit: 2
      scheduleTriggerConfig: {
        cronExpression: job.schedule
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: [
        {
          server: containerRegistryLoginServer
          identity: runtimeIdentityResourceId
        }
      ]
      secrets: [
        {
          name: 'worker-shared-secret'
          keyVaultUrl: '${keyVaultBaseUri}secrets/pipeline-worker-shared-secret'
          identity: keyVaultSecretIdentity
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'pipeline-job'
          image: containerImage
          command: ['node']
          args: ['--input-type=module', '--eval', jobRunner]
          env: [
            {
              name: 'PIPELINE_JOB_URL'
              value: 'http://${web.name}${job.path}'
            }
            {
              name: 'PIPELINE_WORKER_SHARED_SECRET'
              secretRef: 'worker-shared-secret'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}]

output containerAppName string = web.name
output containerAppFqdn string = web.properties.configuration.ingress.fqdn
output applicationUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
output livenessUrl string = 'https://${web.properties.configuration.ingress.fqdn}/api/health/live'
output readinessUrl string = 'https://${web.properties.configuration.ingress.fqdn}/api/health'
output pipelineApiScope string = pipelineApiScope
output databaseBootstrapJobName string = databaseBootstrapJobName
output databaseMigrationJobName string = databaseMigrationJob.name
output scheduledJobNames array = map(filter(scheduledJobs, job => job.enabled), job => take('${namePrefix}-${environment}-${job.name}', 32))
