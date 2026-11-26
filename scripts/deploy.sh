#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_NAME="${1:-campusfind}"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"

for command_name in aws sam; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done
if [[ -z "$REGION" ]]; then
  echo "Set AWS_REGION or configure a default AWS CLI region first." >&2
  exit 1
fi

cd "$APP_DIR"
sam build --template-file template.yaml
# AWS Academy: Lambda runs as the lab's LabRole (the sandbox cannot create roles). Override with LAB_ROLE_ARN.
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
LAB_ROLE_ARN="${LAB_ROLE_ARN:-arn:aws:iam::$ACCOUNT_ID:role/LabRole}"
sam deploy --resolve-s3 --capabilities CAPABILITY_IAM --stack-name "$STACK_NAME" --region "$REGION" --no-confirm-changeset --no-fail-on-empty-changeset --parameter-overrides "LabRoleArn=$LAB_ROLE_ARN" "AllowedEmailDomain=${ALLOWED_EMAIL_DOMAIN-thapar.edu}"

get_output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

API_URL="$(get_output ApiUrl)"
WEB_BUCKET="$(get_output BucketName)"
SITE_URL="$(get_output SiteUrl)"
COGNITO_DOMAIN="$(get_output CognitoDomain)"
CLIENT_ID="$(get_output UserPoolClientId)"
DISTRIBUTION_ID="$(get_output DistributionId)"

for value in "$API_URL" "$WEB_BUCKET" "$SITE_URL" "$COGNITO_DOMAIN" "$CLIENT_ID" "$DISTRIBUTION_ID"; do
  if [[ -z "$value" || "$value" == "None" ]]; then
    echo "A required CloudFormation output is missing. Check stack '$STACK_NAME'." >&2
    exit 1
  fi
done

WEB_DIR="$APP_DIR/web"
cat > "$WEB_DIR/config.js" <<CONFIG
/* Written by scripts/deploy.sh from the $STACK_NAME CloudFormation outputs. Empty values = in-browser demo mode. */
window.CAMPUSFIND_CONFIG = {
  apiUrl: '$API_URL',
  cognitoDomain: '$COGNITO_DOMAIN',
  clientId: '$CLIENT_ID',
};
CONFIG

# The demo backend imports the API's own matching module; refuse to ship a stale copy.
cp "$APP_DIR/docs/architecture.png" "$WEB_DIR/architecture.png"
cmp -s "$APP_DIR/backend/src/matching.js" "$WEB_DIR/js/matching.js" || cp "$APP_DIR/backend/src/matching.js" "$WEB_DIR/js/matching.js"

aws s3 sync "$WEB_DIR" "s3://$WEB_BUCKET" --region "$REGION" --delete --exclude '.DS_Store'
aws s3 cp "$WEB_DIR/manifest.webmanifest" "s3://$WEB_BUCKET/manifest.webmanifest" --region "$REGION" --content-type 'application/manifest+json'
# CloudFront caches files at the edge; clear it so this deploy is what students see.
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths '/*' --query 'Invalidation.Status' --output text

echo
echo "CampusFind is ready: $SITE_URL"
echo "Operations dashboard: $(get_output DashboardUrl)"
echo "Stack: $STACK_NAME | Region: $REGION"
echo "For cleanup after the demonstration: bash scripts/cleanup.sh $STACK_NAME"
