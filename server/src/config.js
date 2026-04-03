import fs from 'node:fs';
import path from 'node:path';

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

function resolveDefaultPythonBin() {
  const fromEnv = String(process.env.TREND_ANALYZER_PYTHON_BIN || '').trim();
  if (fromEnv) return fromEnv;

  const candidates = [
    path.resolve(process.cwd(), '.venv-trend-check', 'bin', 'python'),
    path.resolve(process.cwd(), '..', '.venv-trend-check', 'bin', 'python')
  ];
  const localCandidate = candidates.find((candidate) => fs.existsSync(candidate));
  return localCandidate || 'python3';
}

export function getConfig() {
  const uploadRoot = process.env.UPLOAD_ROOT || '/data/uploads';
  const defaultPythonBin = resolveDefaultPythonBin();
  return {
    port: Number(process.env.PORT || 8200),
    databaseUrl: required('DATABASE_URL'),
    adminToken: String(process.env.ADMIN_TOKEN || '').trim(),
    adminSessionSecret: required('ADMIN_SESSION_SECRET'),
    adminLoginUser: String(process.env.ADMIN_LOGIN_USER || '').trim().toLowerCase(),
    adminLoginPassword: String(process.env.ADMIN_LOGIN_PASSWORD || '').trim(),
    cookieDomain: String(process.env.COOKIE_DOMAIN || '').trim(),
    uploadRoot,
    mediaRoot: path.join(uploadRoot, 'media'),
    mediaPublicBaseUrl: String(process.env.MEDIA_PUBLIC_BASE_URL || '').trim(),
    nodeEnv: String(process.env.NODE_ENV || 'development').trim(),
    siteOrigin: String(process.env.SITE_ORIGIN || '').trim(),
    trendAnalyzerPythonBin: defaultPythonBin,
    trendAnalyzerScript: String(process.env.TREND_ANALYZER_SCRIPT || path.join(process.cwd(), 'scripts', 'trend_analyze_csv.py')).trim(),
    trendAnalyzerBestParamsCsv: String(
      process.env.TREND_ANALYZER_BEST_PARAMS_CSV ||
        path.join(process.cwd(), 'web_backend_bundle', 'best_params', 'optimizer_best_params_by_head.csv')
    ).trim(),
    trendAnalyzerTimeoutMs: Number(process.env.TREND_ANALYZER_TIMEOUT_MS || 20000),
    chartInterpretationPythonBin: String(process.env.CHART_INTERPRETATION_PYTHON_BIN || defaultPythonBin).trim(),
    chartInterpretationScript: String(
      process.env.CHART_INTERPRETATION_SCRIPT || path.join(process.cwd(), 'scripts', 'chart_interpretation_run.py')
    ).trim(),
    chartInterpretationWorkspaceRoot: String(
      process.env.CHART_INTERPRETATION_WORKSPACE_ROOT || path.join(uploadRoot, 'chart-interpretation')
    ).trim(),
    chartInterpretationTimeoutMs: Number(process.env.CHART_INTERPRETATION_TIMEOUT_MS || 45000)
  };
}
