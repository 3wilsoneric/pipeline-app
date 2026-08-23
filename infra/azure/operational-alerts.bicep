targetScope = 'resourceGroup'

param namePrefix string
param environment string
param location string
param logAnalyticsWorkspaceId string
param postgresServerId string
param storageAccountId string
param actionGroupResourceIds array = []
param enabled bool = true

@minValue(1)
param postgresConnectionAlertThreshold int = 60

@minValue(1)
@maxValue(100)
param postgresStorageAlertPercent int = 75

@minValue(1073741824)
param blobStorageAlertBytes int = 85899345920

var common = {
  kind: 'LogAlert'
  location: location
  tags: {
    application: 'pipeline'
    environment: environment
    dataClassification: 'phi-safe-metrics-only'
  }
}

var alerts = [
  {
    key: 'save-conflicts'
    displayName: 'Pipeline save conflicts'
    description: 'Concurrent edits are producing repeated optimistic-version conflicts.'
    severity: 2
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 5
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.referral.save_conflicts'
| summarize MetricValue = sum(todouble(payload.value))
'''
  }
  {
    key: 'queue-age'
    displayName: 'Pipeline oldest queue item'
    description: 'The oldest active referral action is more than 24 hours old.'
    severity: 2
    frequency: 'PT15M'
    window: 'PT30M'
    threshold: 86400000
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.queue.oldest_age'
| summarize MetricValue = max(todouble(payload.value))
'''
  }
  {
    key: 'extraction-failures'
    displayName: 'Pipeline extraction failures'
    description: 'Referral packet extraction has failed or entered a dead-letter state.'
    severity: 1
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 0
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.extraction.failures'
| summarize MetricValue = sum(todouble(payload.value))
'''
  }
  {
    key: 'authorization-failures'
    displayName: 'Pipeline authorization failures'
    description: 'Repeated 401 or 403 responses may indicate expired configuration or access abuse.'
    severity: 2
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 10
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.service) == 'pipeline-app' and toint(payload.status) in (401, 403)
| summarize MetricValue = count()
'''
  }
  {
    key: 'response-latency'
    displayName: 'Pipeline API latency'
    description: 'The Pipeline API p95 response duration exceeds two seconds.'
    severity: 2
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 2000
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.api.duration'
| summarize MetricValue = percentile(todouble(payload.value), 95)
'''
  }
  {
    key: 'overload-rejections'
    displayName: 'Pipeline overload rejections'
    description: 'An application instance rejected work because its concurrency capacity was exhausted.'
    severity: 1
    frequency: 'PT5M'
    window: 'PT10M'
    threshold: 0
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.api.overload_rejections'
| summarize MetricValue = sum(todouble(payload.value))
'''
  }
  {
    key: 'clinical-upstream'
    displayName: 'Pipeline clinical upstream failures'
    description: 'The governed clinical API is returning repeated unavailable responses.'
    severity: 1
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 5
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.service) == 'pipeline-app'
| where tostring(payload.route) startswith '/api/clinical/' and toint(payload.status) >= 500
| summarize MetricValue = count()
'''
  }
  {
    key: 'stale-presence-leases'
    displayName: 'Pipeline stale editing leases'
    description: 'Editing presence leases are expiring faster than routine cleanup should produce.'
    severity: 2
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 25
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.presence.stale_leases'
| summarize MetricValue = sum(todouble(payload.value))
'''
  }
  {
    key: 'extraction-queue-depth'
    displayName: 'Pipeline extraction queue depth'
    description: 'More than 100 packet-processing jobs are waiting or running.'
    severity: 2
    frequency: 'PT5M'
    window: 'PT30M'
    threshold: 100
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.extraction.queue_depth'
| where tostring(payload.dimensions.result) in ('queued', 'running')
| summarize MetricValue = max(todouble(payload.value))
'''
  }
  {
    key: 'extraction-oldest-age'
    displayName: 'Pipeline extraction queue age'
    description: 'The oldest active packet-processing job has waited more than 30 minutes.'
    severity: 1
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 1800000
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.extraction.oldest_age'
| summarize MetricValue = max(todouble(payload.value))
'''
  }
  {
    key: 'storage-failures'
    displayName: 'Pipeline private storage failures'
    description: 'Blob properties, deletion, or managed-identity delegation failed.'
    severity: 1
    frequency: 'PT5M'
    window: 'PT15M'
    threshold: 0
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) in ('pipeline.storage.failures', 'pipeline.storage.inventory_failures')
| summarize MetricValue = sum(todouble(payload.value))
'''
  }
  {
    key: 'retention-failures'
    displayName: 'Pipeline retention failures'
    description: 'A scheduled document or workspace retention operation could not complete.'
    severity: 1
    frequency: 'PT15M'
    window: 'PT30M'
    threshold: 0
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) in ('pipeline.retention.documents', 'pipeline.retention.referrals')
| where tostring(payload.dimensions.result) == 'failed'
| summarize MetricValue = sum(todouble(payload.value))
'''
  }
  {
    key: 'clinical-freshness'
    displayName: 'Pipeline clinical snapshot freshness'
    description: 'The governed clinical snapshot is more than 25 hours old.'
    severity: 1
    frequency: 'PT15M'
    window: 'PT30M'
    threshold: 90000000
    operator: 'GreaterThan'
    query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.kind) == 'metric' and tostring(payload.metric) == 'pipeline.clinical.freshness_age'
| summarize MetricValue = max(todouble(payload.value))
'''
  }
]

resource operationalAlerts 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [for alert in alerts: if (enabled) {
  name: take('${namePrefix}-${environment}-${alert.key}', 260)
  location: common.location
  kind: common.kind
  tags: common.tags
  properties: {
    actions: {
      actionGroups: actionGroupResourceIds
    }
    autoMitigate: true
    checkWorkspaceAlertsStorageConfigured: false
    criteria: {
      allOf: [
        {
          failingPeriods: {
            minFailingPeriodsToAlert: 1
            numberOfEvaluationPeriods: 1
          }
          metricMeasureColumn: 'MetricValue'
          operator: alert.operator
          query: alert.query
          threshold: alert.threshold
          timeAggregation: 'Maximum'
        }
      ]
    }
    description: alert.description
    displayName: alert.displayName
    enabled: true
    evaluationFrequency: alert.frequency
    scopes: [logAnalyticsWorkspaceId]
    severity: alert.severity
    // The Container Apps custom table is created only after the first runtime log arrives.
    skipQueryValidation: true
    windowSize: alert.window
  }
}]

resource postgresConnectionsAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enabled) {
  name: take('${namePrefix}-${environment}-postgres-connections', 260)
  location: 'global'
  tags: common.tags
  properties: {
    description: 'PostgreSQL active connections are approaching the Pipeline application pool budget.'
    severity: 2
    enabled: true
    scopes: [postgresServerId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'ActiveConnections'
          metricName: 'active_connections'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          operator: 'GreaterThan'
          threshold: postgresConnectionAlertThreshold
          timeAggregation: 'Average'
          skipMetricValidation: false
        }
      ]
    }
    actions: [for actionGroupId in actionGroupResourceIds: { actionGroupId: actionGroupId }]
  }
}

resource postgresStorageAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enabled) {
  name: take('${namePrefix}-${environment}-postgres-storage', 260)
  location: 'global'
  tags: common.tags
  properties: {
    description: 'PostgreSQL storage utilization exceeded the operational headroom target.'
    severity: 1
    enabled: true
    scopes: [postgresServerId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT30M'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'StoragePercent'
          metricName: 'storage_percent'
          metricNamespace: 'Microsoft.DBforPostgreSQL/flexibleServers'
          operator: 'GreaterThan'
          threshold: postgresStorageAlertPercent
          timeAggregation: 'Maximum'
          skipMetricValidation: false
        }
      ]
    }
    actions: [for actionGroupId in actionGroupResourceIds: { actionGroupId: actionGroupId }]
  }
}

resource blobCapacityAlert 'Microsoft.Insights/metricAlerts@2018-03-01' = if (enabled) {
  name: take('${namePrefix}-${environment}-blob-capacity', 260)
  location: 'global'
  tags: common.tags
  properties: {
    description: 'Pipeline Blob Storage tracked capacity exceeded the configured planning threshold.'
    severity: 2
    enabled: true
    scopes: [storageAccountId]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT6H'
    autoMitigate: true
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          criterionType: 'StaticThresholdCriterion'
          name: 'UsedCapacity'
          metricName: 'UsedCapacity'
          metricNamespace: 'Microsoft.Storage/storageAccounts'
          operator: 'GreaterThan'
          threshold: blobStorageAlertBytes
          timeAggregation: 'Average'
          skipMetricValidation: false
        }
      ]
    }
    actions: [for actionGroupId in actionGroupResourceIds: { actionGroupId: actionGroupId }]
  }
}

output alertRuleCount int = enabled ? length(alerts) + 3 : 0
