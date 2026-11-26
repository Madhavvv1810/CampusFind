#!/usr/bin/env bash
set -euo pipefail

STACK_NAME="${1:-campusfind}"
REGION="${AWS_REGION:-$(aws configure get region 2>/dev/null || true)}"
if ! command -v aws >/dev/null 2>&1; then
  echo "Missing required command: aws" >&2
  exit 1
fi
if [[ -z "$REGION" ]]; then
  echo "Set AWS_REGION or configure a default AWS CLI region first." >&2
  exit 1
fi

get_output() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue | [0]" --output text
}

WEB_BUCKET="$(get_output BucketName)"
PHOTO_BUCKET="$(get_output PhotoBucketName)"
if [[ "$WEB_BUCKET" == "None" || "$PHOTO_BUCKET" == "None" ]]; then
  echo "Could not find the stack's S3 bucket outputs. No resources were changed." >&2
  exit 1
fi

echo "This permanently deletes all objects in s3://$WEB_BUCKET and s3://$PHOTO_BUCKET, then deletes stack '$STACK_NAME' in $REGION."
read -r -p "Type the stack name to continue: " confirmation
if [[ "$confirmation" != "$STACK_NAME" ]]; then
  echo "Cleanup cancelled."
  exit 0
fi

aws s3 rm "s3://$WEB_BUCKET" --recursive --region "$REGION"
aws s3 rm "s3://$PHOTO_BUCKET" --recursive --region "$REGION"
aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"
echo "Stack '$STACK_NAME' and its app resources have been deleted."
