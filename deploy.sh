#!/bin/bash
set -euo pipefail
RED='\033[0;31m';GREEN='\033[0;32m';YELLOW='\033[1;33m';BLUE='\033[0;34m';BOLD='\033[1m';NC='\033[0m'
log(){ echo -e "${BOLD}${BLUE}[DROCART]${NC} $1"; }
ok(){ echo -e "${GREEN}✓${NC} $1"; }
err(){ echo -e "${RED}✕ ERROR:${NC} $1"; exit 1; }

COMMAND=${1:-help}
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TF_DIR="$ROOT_DIR/terraform"

get_output(){ cd "$TF_DIR" && terraform output -raw "$1" 2>/dev/null || echo ""; }

check_prereqs(){
  log "Checking prerequisites…"
  for cmd in terraform aws; do command -v $cmd &>/dev/null && ok "$cmd" || err "$cmd not found"; done
  aws sts get-caller-identity &>/dev/null || err "AWS credentials not configured. Run: aws configure"
}

tf_init(){
  log "Initialising Terraform…"
  cd "$TF_DIR"
  [ -f terraform.tfvars ] || err "terraform.tfvars not found. Copy terraform.tfvars.example and fill values."
  terraform init -upgrade
}

tf_plan(){  tf_init; log "Planning…"; cd "$TF_DIR"; terraform plan -var-file=terraform.tfvars; }
tf_apply(){ tf_init; log "Applying (RDS takes ~15min)…"; cd "$TF_DIR"; terraform apply -auto-approve -var-file=terraform.tfvars; show_outputs; }
tf_destroy(){
  echo -e "${RED}WARNING: This destroys ALL infrastructure including the database!${NC}"
  read -p "Type 'yes-destroy-drocart' to confirm: " c
  [ "$c" = "yes-destroy-drocart" ] || { log "Aborted."; exit 0; }
  cd "$TF_DIR"; terraform destroy -auto-approve -var-file=terraform.tfvars
}

show_outputs(){
  log "Outputs:"
  echo -e "  ${BOLD}External ALB${NC}: $(get_output external_alb_dns)"
  echo -e "  ${BOLD}Internal ALB${NC}: $(get_output internal_alb_dns)"
  echo -e "  ${BOLD}RDS Endpoint${NC}: $(get_output rds_endpoint)"
  echo -e "  ${BOLD}Backend S3  ${NC}: s3://$(get_output s3_backend_bucket)"
  echo -e "  ${BOLD}Frontend S3 ${NC}: s3://$(get_output s3_frontend_bucket)"
}

upload_backend(){
  log "Uploading backend/ to S3…"
  BUCKET=$(get_output s3_backend_bucket); [ -z "$BUCKET" ] && err "Run terraform apply first"
  REGION=$(grep aws_region "$TF_DIR/terraform.tfvars" 2>/dev/null | awk -F'"' '{print $2}' || echo "ap-south-1")
  aws s3 sync "$ROOT_DIR/backend/" "s3://$BUCKET/" --region "$REGION" \
    --exclude "venv/*" --exclude "__pycache__/*" --exclude "*.pyc" --exclude ".env" --delete
  ok "backend/ → s3://$BUCKET/"
}

upload_frontend(){
  log "Uploading frontend/ to S3…"
  BUCKET=$(get_output s3_frontend_bucket); [ -z "$BUCKET" ] && err "Run terraform apply first"
  REGION=$(grep aws_region "$TF_DIR/terraform.tfvars" 2>/dev/null | awk -F'"' '{print $2}' || echo "ap-south-1")
  aws s3 sync "$ROOT_DIR/frontend/" "s3://$BUCKET/" --region "$REGION" \
    --exclude "nginx/*" --exclude "Dockerfile" \
    --cache-control "public,max-age=31536000,immutable" --delete
  ok "frontend/ → s3://$BUCKET/"
}

seed_db(){
  log "Seeding database…"
  RDS=$(get_output rds_endpoint | cut -d: -f1); [ -z "$RDS" ] && err "No RDS endpoint"
  DB_USER=$(grep db_user     "$TF_DIR/terraform.tfvars" | awk -F'"' '{print $2}')
  DB_PASS=$(grep db_password "$TF_DIR/terraform.tfvars" | awk -F'"' '{print $2}')
  mysql -h "$RDS" -u "$DB_USER" -p"$DB_PASS" < "$ROOT_DIR/backend/database.sql"
  ok "Database seeded"
}

roll(){
  log "Starting rolling deploy…"
  REGION=$(grep aws_region "$TF_DIR/terraform.tfvars" 2>/dev/null | awk -F'"' '{print $2}' || echo "ap-south-1")
  for ASG in $(get_output app_asg_name) $(get_output web_asg_name); do
    [ -n "$ASG" ] && aws autoscaling start-instance-refresh \
      --auto-scaling-group-name "$ASG" --strategy Rolling \
      --preferences '{"MinHealthyPercentage":50,"InstanceWarmup":180}' \
      --region "$REGION" && ok "Rolling deploy started: $ASG"
  done
}

status(){
  log "Deployment status…"
  EXT=$(get_output external_alb_dns)
  [ -n "$EXT" ] && HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://$EXT/health" --max-time 5 2>/dev/null || echo "timeout")
  [ "${HTTP:-timeout}" = "200" ] && ok "Health check: $HTTP" || echo -e "${YELLOW}⚠${NC} Health: ${HTTP:-timeout}"
  show_outputs
}

rollback(){
  log "Rolling back to previous launch template version…"
  REGION=$(grep aws_region "$TF_DIR/terraform.tfvars" 2>/dev/null | awk -F'"' '{print $2}' || echo "ap-south-1")
  for ASG in $(get_output app_asg_name) $(get_output web_asg_name); do
    [ -z "$ASG" ] && continue
    LT=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names "$ASG" --region "$REGION" --query 'AutoScalingGroups[0].LaunchTemplate.LaunchTemplateId' --output text)
    PREV=$(aws ec2 describe-launch-template-versions --launch-template-id "$LT" --region "$REGION" --query 'sort_by(LaunchTemplateVersions,&VersionNumber)[-2].VersionNumber' --output text 2>/dev/null || echo "1")
    aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$ASG" --region "$REGION" --launch-template "LaunchTemplateId=$LT,Version=$PREV"
    aws autoscaling start-instance-refresh --auto-scaling-group-name "$ASG" --strategy Rolling --preferences '{"MinHealthyPercentage":50}' --region "$REGION"
    ok "Rollback: $ASG → LT v$PREV"
  done
}

full(){
  check_prereqs
  upload_backend
  upload_frontend
  tf_apply
  seed_db
  roll
  status
  ok "Full deployment complete!"
}

help(){
  echo -e "\n${BOLD}Usage:${NC} ./deploy.sh <command>\n"
  echo "  plan             Terraform plan (dry run)"
  echo "  apply            Create/update infrastructure"
  echo "  destroy          Tear down everything"
  echo "  upload           Upload backend/ + frontend/ to S3"
  echo "  upload-backend   Upload only backend/ to S3"
  echo "  upload-frontend  Upload only frontend/ to S3"
  echo "  seed-db          Seed RDS with schema + data"
  echo "  roll             Rolling deploy (ASG instance refresh)"
  echo "  status           Health check + outputs"
  echo "  rollback         Revert to previous launch template"
  echo "  full             Complete pipeline: upload + apply + seed + roll"
  echo "  outputs          Show Terraform outputs"
}

case "$COMMAND" in
  plan)            check_prereqs && tf_plan ;;
  apply)           check_prereqs && tf_apply ;;
  destroy)         tf_destroy ;;
  upload)          upload_backend && upload_frontend ;;
  upload-backend)  upload_backend ;;
  upload-frontend) upload_frontend ;;
  seed-db)         seed_db ;;
  roll)            roll ;;
  status)          status ;;
  rollback)        rollback ;;
  full)            full ;;
  outputs)         show_outputs ;;
  help|*)          help ;;
esac
