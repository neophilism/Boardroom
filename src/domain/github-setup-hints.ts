/** Owner-only troubleshooting labels. This map contains no secrets. */
export const GITHUB_APP_DIAGNOSTICS={
  NOT_CONFIGURED:"The GitHub App environment variables are missing. Add App ID, installation ID, private key, and owner in Render.",
  APP_ID_MISSING:"BOARDROOM_GITHUB_APP_ID is missing. Copy the numeric App ID from GitHub App → General.",
  APP_ID_INVALID:"BOARDROOM_GITHUB_APP_ID must be the numeric App ID, not the App name or installation ID.",
  INSTALLATION_ID_MISSING:"BOARDROOM_GITHUB_INSTALLATION_ID is missing. Use the numeric ID from GitHub → Settings → Applications → Installed GitHub Apps.",
  INSTALLATION_ID_INVALID:"BOARDROOM_GITHUB_INSTALLATION_ID must be the numeric installation ID, not the App ID.",
  PRIVATE_KEY_MISSING:"BOARDROOM_GITHUB_APP_PRIVATE_KEY is missing. Generate and store the GitHub App private key in Render's secure environment.",
  PRIVATE_KEY_INVALID:"The GitHub App private key cannot sign a JWT. Paste the complete PEM (including BEGIN/END lines) for the same App in Render; avoid extra quote characters.",
  APP_AUTH_REJECTED:"GitHub rejected the App JWT (HTTP 401). Check that the numeric App ID matches the App that issued the PEM private key, then verify the stored key.",
  INSTALLATION_NOT_FOUND:"GitHub did not find the installation ID (HTTP 404). Use the installation ID from the GitHub App installation URL, not the App ID.",
  INSTALLATION_FORBIDDEN:"GitHub refused App installation access (HTTP 403). Check the installation is active and authorized for the account or organization.",
  GITHUB_TEMPORARILY_UNAVAILABLE:"GitHub rejected the request or is temporarily unavailable. Recheck the GitHub App installation and retry.",
  GITHUB_NETWORK_ERROR:"Boardroom could not reach the GitHub API. Retry once GitHub network access is available.",
  INSTALLATION_RESPONSE_INVALID:"GitHub authentication did not return a usable installation token. Recheck the installation.",
  NO_REPOSITORIES:"The GitHub App can authenticate but has no authorized repositories. Install it on at least one intended repository.",
  MISSING_PERMISSIONS:"The GitHub App is missing required permissions. Update the App's permissions and approve the changes on GitHub.",
  REPOSITORY_API_REJECTED:"GitHub denied the installed App access to its repository list. Recheck installation status and permissions.",
  UNKNOWN:"The GitHub App connection could not be verified. Check the installation settings and Render service logs."
} as const;
export type GitHubAppDiagnosticCode=keyof typeof GITHUB_APP_DIAGNOSTICS;
export function githubDiagnosticHint(code:GitHubAppDiagnosticCode|null|undefined):string|null{
  return code?GITHUB_APP_DIAGNOSTICS[code]??GITHUB_APP_DIAGNOSTICS.UNKNOWN:null;
}
