{{- define "remotecache.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "remotecache.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "remotecache.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "remotecache.selectorLabels" -}}
app.kubernetes.io/name: {{ include "remotecache.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "remotecache.labels" -}}
helm.sh/chart: {{ include "remotecache.chart" . }}
{{ include "remotecache.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "remotecache.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "remotecache.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{- define "remotecache.adminSecretName" -}}
{{- if .Values.existingSecret }}{{ .Values.existingSecret }}{{ else }}{{ include "remotecache.fullname" . }}-admin{{ end }}
{{- end }}

{{- define "remotecache.adminSecretKey" -}}
{{- if .Values.existingSecret }}{{ .Values.existingSecretKey }}{{ else }}admin-token{{ end }}
{{- end }}

{{- define "remotecache.s3SecretName" -}}
{{- if .Values.s3.existingSecret }}{{ .Values.s3.existingSecret }}{{ else }}{{ include "remotecache.fullname" . }}-s3{{ end }}
{{- end }}
