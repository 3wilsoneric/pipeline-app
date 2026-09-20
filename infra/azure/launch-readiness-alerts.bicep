// Additive deployment: does not redeploy the runtime, database, or existing alerts.
targetScope = 'resourceGroup'

param location string = resourceGroup().location
param applicationInsightsName string
param logAnalyticsWorkspaceName string
@minLength(1)
param actionGroupResourceIds array
param namePrefix string = 'pipeline-prod'
@allowed(['https://alamo-pipeline.com/api/health'])
param healthUrl string = 'https://alamo-pipeline.com/api/health'

resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: applicationInsightsName
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

resource failedSaves 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = {
  name: '${namePrefix}-failed-saves'
  location: location
  kind: 'LogAlert'
  tags: { application: 'pipeline', dataClassification: 'phi-safe-metrics-only' }
  properties: {
    displayName: 'Pipeline failed saves and updates'
    description: 'A user-facing mutation returned a server error. Inspect safe route/status metadata and preserve the user draft; never retry clinical writes blindly.'
    enabled: true
    severity: 1
    evaluationFrequency: 'PT5M'
    windowSize: 'PT10M'
    scopes: [logs.id]
    autoMitigate: true
    skipQueryValidation: false
    criteria: {
      allOf: [{
        query: '''
ContainerAppConsoleLogs_CL
| extend payload = parse_json(Log_s)
| where tostring(payload.service) == 'pipeline-app'
| where toint(payload.status) >= 500
| where tostring(payload.method) in ('POST', 'PUT', 'PATCH', 'DELETE')
| where tostring(payload.route) startswith '/api/'
| where not(tostring(payload.route) startswith '/api/internal/')
| summarize MetricValue = count()
'''
        timeAggregation: 'Maximum'
        metricMeasureColumn: 'MetricValue'
        operator: 'GreaterThan'
        threshold: 0
        failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
      }]
    }
    actions: { actionGroups: actionGroupResourceIds }
  }
}

resource availability 'Microsoft.Insights/webtests@2022-06-15' = {
  name: '${namePrefix}-public-readiness'
  location: location
  kind: 'standard'
  tags: { 'hidden-link:${insights.id}': 'Resource', application: 'pipeline' }
  properties: {
    Name: '${namePrefix}-public-readiness'
    SyntheticMonitorId: '${namePrefix}-public-readiness'
    Description: 'Public DNS, TLS, ingress, app readiness and the database connection. No credentials, client records, or mutations.'
    Kind: 'standard'
    Enabled: true
    Frequency: 300
    Timeout: 30
    RetryEnabled: true
    Locations: [
      { Id: 'us-ca-sjc-azr' }
      { Id: 'us-tx-sn1-azr' }
      { Id: 'us-va-ash-azr' }
    ]
    Request: {
      RequestUrl: healthUrl
      HttpVerb: 'GET'
      FollowRedirects: false
      ParseDependentRequests: false
    }
    ValidationRules: {
      ExpectedHttpStatusCode: 200
      IgnoreHttpStatusCode: false
      SSLCheck: true
      SSLCertRemainingLifetimeCheck: 7
      ContentValidation: { ContentMatch: '"ok":true', IgnoreCase: false, PassIfTextFound: true }
    }
  }
}

resource outage 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${namePrefix}-public-outage'
  location: 'global'
  tags: { application: 'pipeline' }
  properties: {
    description: 'Pipeline readiness failed from at least two of three external locations. Check deployment, database readiness, DNS and TLS before rollback.'
    severity: 1
    enabled: true
    autoMitigate: true
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    scopes: [availability.id, insights.id]
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.WebtestLocationAvailabilityCriteria'
      webTestId: availability.id
      componentId: insights.id
      failedLocationCount: 2
    }
    actions: [for id in actionGroupResourceIds: { actionGroupId: id }]
  }
}

output failedSaveAlertId string = failedSaves.id
output readinessTestId string = availability.id
output outageAlertId string = outage.id
