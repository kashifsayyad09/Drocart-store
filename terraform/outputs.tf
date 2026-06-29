output "external_alb_dns"     { value = aws_lb.external.dns_name }
output "internal_alb_dns"     { value = aws_lb.internal.dns_name }
output "rds_endpoint"         { value = aws_db_instance.primary.endpoint }
output "rds_replica_endpoint" { value = try(aws_db_instance.replica[0].endpoint,"N/A") }
output "s3_backend_bucket"    { value = aws_s3_bucket.backend.id }
output "s3_frontend_bucket"   { value = aws_s3_bucket.frontend.id }
output "vpc_id"               { value = aws_vpc.main.id }
output "nat_gateway_ips"      { value = aws_eip.nat[*].public_ip }
output "web_asg_name"         { value = aws_autoscaling_group.web.name }
output "app_asg_name"         { value = aws_autoscaling_group.app.name }
output "cloudwatch_dashboard" { value = "https://${var.aws_region}.console.aws.amazon.com/cloudwatch/home#dashboards:name=${aws_cloudwatch_dashboard.main.dashboard_name}" }

output "deploy_summary" {
  value = <<-EOT
    DROCART — AWS Three-Tier Deployment
    ====================================
    External ALB : ${aws_lb.external.dns_name}
    Internal ALB : ${aws_lb.internal.dns_name}
    RDS Primary  : ${aws_db_instance.primary.endpoint}
    Web ASG      : ${aws_autoscaling_group.web.name}
    App ASG      : ${aws_autoscaling_group.app.name}
    Backend S3   : s3://${aws_s3_bucket.backend.id}
    Frontend S3  : s3://${aws_s3_bucket.frontend.id}

    NEXT STEPS:
      1. Upload backend:  aws s3 sync backend/ s3://${aws_s3_bucket.backend.id}/
      2. Upload frontend: aws s3 sync frontend/ s3://${aws_s3_bucket.frontend.id}/
      3. Seed DB:        mysql -h ${aws_db_instance.primary.endpoint} -u ${var.db_user} -p < backend/database.sql
      4. Update nginx.conf: Replace INTERNAL_ALB_DNS_PLACEHOLDER with ${aws_lb.internal.dns_name}
      5. Point DNS:      CNAME drocart.com → ${aws_lb.external.dns_name}
  EOT
}
