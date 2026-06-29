# ============================================================
#  DROCART MONOLITH — Terraform Infrastructure
#  AWS Three-Tier Architecture
#  External ALB → Web EC2 (Nginx) → Internal ALB → App EC2 (Flask)
#                                                 → RDS MySQL Multi-AZ
# ============================================================

terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.5" }
  }
  backend "s3" {
    bucket         = "drocart-tf-state"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    encrypt        = true
    dynamodb_table = "drocart-tf-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = { Project = "Drocart", Environment = var.env, ManagedBy = "Terraform" }
  }
}

data "aws_availability_zones" "azs" { state = "available" }
data "aws_caller_identity"    "me"  {}

locals {
  azs  = slice(data.aws_availability_zones.azs.names, 0, 2)
  name = "${var.project}-${var.env}"
}

resource "random_id" "s3" { byte_length = 4 }

# ─────────────────────────────────────────────
# VPC
# ─────────────────────────────────────────────
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "${local.name}-vpc" }
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "${local.name}-public-${local.azs[count.index]}", Tier = "Public" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.private_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags = { Name = "${local.name}-private-${local.azs[count.index]}", Tier = "Private" }
}

resource "aws_subnet" "db" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = var.db_cidrs[count.index]
  availability_zone = local.azs[count.index]
  tags = { Name = "${local.name}-db-${local.azs[count.index]}", Tier = "Database" }
}

resource "aws_eip" "nat" {
  count  = 2
  domain = "vpc"
  tags   = { Name = "${local.name}-eip-nat-${count.index}" }
}

resource "aws_nat_gateway" "nat" {
  count         = 2
  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  tags          = { Name = "${local.name}-nat-${local.azs[count.index]}" }
  depends_on    = [aws_internet_gateway.igw]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route { cidr_block = "0.0.0.0/0"; gateway_id = aws_internet_gateway.igw.id }
  tags = { Name = "${local.name}-rt-public" }
}
resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = 2
  vpc_id = aws_vpc.main.id
  route  { cidr_block = "0.0.0.0/0"; nat_gateway_id = aws_nat_gateway.nat[count.index].id }
  tags = { Name = "${local.name}-rt-private-${local.azs[count.index]}" }
}
resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

resource "aws_route_table" "db" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-rt-db" }
}
resource "aws_route_table_association" "db" {
  count          = 2
  subnet_id      = aws_subnet.db[count.index].id
  route_table_id = aws_route_table.db.id
}

resource "aws_cloudwatch_log_group" "flow" {
  name              = "/aws/vpc/${local.name}"
  retention_in_days = 30
}
resource "aws_iam_role" "flow" {
  name = "${local.name}-flow-role"
  assume_role_policy = jsonencode({ Version="2012-10-17", Statement=[{ Effect="Allow", Principal={Service="vpc-flow-logs.amazonaws.com"}, Action="sts:AssumeRole" }] })
}
resource "aws_iam_role_policy" "flow" {
  role   = aws_iam_role.flow.id
  policy = jsonencode({ Version="2012-10-17", Statement=[{ Effect="Allow", Action=["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents","logs:DescribeLogGroups","logs:DescribeLogStreams"], Resource="*" }] })
}
resource "aws_flow_log" "vpc" {
  iam_role_arn    = aws_iam_role.flow.arn
  log_destination = aws_cloudwatch_log_group.flow.arn
  traffic_type    = "ALL"
  vpc_id          = aws_vpc.main.id
}

# ─────────────────────────────────────────────
# SECURITY GROUPS
# ─────────────────────────────────────────────
resource "aws_security_group" "ext_alb" {
  name   = "${local.name}-ext-alb-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=80;  to_port=80;  protocol="tcp"; cidr_blocks=["0.0.0.0/0"]; description="HTTP" }
  ingress { from_port=443; to_port=443; protocol="tcp"; cidr_blocks=["0.0.0.0/0"]; description="HTTPS" }
  egress  { from_port=0;   to_port=0;   protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = { Name="${local.name}-ext-alb-sg", Role="ExternalALB" }
}

resource "aws_security_group" "int_alb" {
  name   = "${local.name}-int-alb-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=80;   to_port=80;   protocol="tcp"; security_groups=[aws_security_group.web.id]; description="HTTP from Web" }
  ingress { from_port=5000; to_port=5000; protocol="tcp"; security_groups=[aws_security_group.web.id]; description="Flask from Web" }
  egress  { from_port=0;    to_port=0;    protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = { Name="${local.name}-int-alb-sg", Role="InternalALB" }
}

resource "aws_security_group" "web" {
  name   = "${local.name}-web-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=80;  to_port=80;  protocol="tcp"; security_groups=[aws_security_group.ext_alb.id]; description="HTTP from Ext ALB" }
  ingress { from_port=443; to_port=443; protocol="tcp"; security_groups=[aws_security_group.ext_alb.id]; description="HTTPS from Ext ALB" }
  ingress { from_port=22;  to_port=22;  protocol="tcp"; cidr_blocks=[var.admin_ip];                      description="SSH admin" }
  egress  { from_port=0;   to_port=0;   protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = { Name="${local.name}-web-sg", Role="WebTier" }
}

resource "aws_security_group" "app" {
  name   = "${local.name}-app-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=5000; to_port=5000; protocol="tcp"; security_groups=[aws_security_group.int_alb.id]; description="Flask from Int ALB" }
  ingress { from_port=80;   to_port=80;   protocol="tcp"; security_groups=[aws_security_group.int_alb.id]; description="HTTP from Int ALB" }
  ingress { from_port=22;   to_port=22;   protocol="tcp"; cidr_blocks=[var.admin_ip];                      description="SSH admin" }
  egress  { from_port=0;    to_port=0;    protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = { Name="${local.name}-app-sg", Role="AppTier" }
}

resource "aws_security_group" "db" {
  name   = "${local.name}-db-sg"
  vpc_id = aws_vpc.main.id
  ingress { from_port=3306; to_port=3306; protocol="tcp"; security_groups=[aws_security_group.app.id]; description="MySQL from App" }
  egress  { from_port=0;    to_port=0;    protocol="-1";  cidr_blocks=["0.0.0.0/0"] }
  tags = { Name="${local.name}-db-sg", Role="Database" }
}

# ─────────────────────────────────────────────
# S3 BUCKETS
# ─────────────────────────────────────────────
resource "aws_s3_bucket" "backend" {
  bucket        = "${local.name}-backend-${random_id.s3.hex}"
  force_destroy = false
  tags          = { Name="${local.name}-backend", Purpose="AppCode" }
}
resource "aws_s3_bucket" "frontend" {
  bucket        = "${local.name}-frontend-${random_id.s3.hex}"
  force_destroy = false
  tags          = { Name="${local.name}-frontend", Purpose="StaticFiles" }
}
resource "aws_s3_bucket" "logs" {
  bucket        = "${local.name}-logs-${random_id.s3.hex}"
  force_destroy = false
  tags          = { Name="${local.name}-logs", Purpose="ALBLogs" }
}

resource "aws_s3_bucket_versioning" "backend" {
  bucket = aws_s3_bucket.backend.id
  versioning_configuration { status = "Enabled" }
}
resource "aws_s3_bucket_server_side_encryption_configuration" "backend" {
  bucket = aws_s3_bucket.backend.id
  rule { apply_server_side_encryption_by_default { sse_algorithm = "AES256" } }
}

# ─────────────────────────────────────────────
# IAM — EC2 Instance Role
# ─────────────────────────────────────────────
resource "aws_iam_role" "ec2" {
  name = "${local.name}-ec2-role"
  assume_role_policy = jsonencode({ Version="2012-10-17", Statement=[{ Effect="Allow", Principal={Service="ec2.amazonaws.com"}, Action="sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role = aws_iam_role.ec2.name; policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_role_policy_attachment" "cw" {
  role = aws_iam_role.ec2.name; policy_arn = "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"
}
resource "aws_iam_role_policy" "s3" {
  name = "${local.name}-s3"
  role = aws_iam_role.ec2.id
  policy = jsonencode({ Version="2012-10-17", Statement=[{ Effect="Allow", Action=["s3:GetObject","s3:ListBucket","s3:PutObject"], Resource=["arn:aws:s3:::${aws_s3_bucket.backend.id}","arn:aws:s3:::${aws_s3_bucket.backend.id}/*","arn:aws:s3:::${aws_s3_bucket.frontend.id}","arn:aws:s3:::${aws_s3_bucket.frontend.id}/*"] }] })
}
resource "aws_iam_role_policy" "metrics" {
  name = "${local.name}-metrics"
  role = aws_iam_role.ec2.id
  policy = jsonencode({ Version="2012-10-17", Statement=[{ Effect="Allow", Action=["cloudwatch:PutMetricData","cloudwatch:GetMetricStatistics","cloudwatch:ListMetrics","ec2:DescribeVolumes","ec2:DescribeTags"], Resource="*" }] })
}
resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name}-ec2-profile"
  role = aws_iam_role.ec2.name
}

# ─────────────────────────────────────────────
# LATEST AMAZON LINUX 2023 AMI
# ─────────────────────────────────────────────
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter { name="name";  values=["al2023-ami-*-x86_64"] }
  filter { name="state"; values=["available"] }
}

# ─────────────────────────────────────────────
# EXTERNAL ALB  (Internet-facing, PUBLIC subnets)
# ─────────────────────────────────────────────
resource "aws_lb" "external" {
  name               = "${local.name}-ext-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.ext_alb.id]
  subnets            = aws_subnet.public[*].id
  enable_deletion_protection       = true
  enable_cross_zone_load_balancing = true
  drop_invalid_header_fields       = true
  access_logs { bucket=aws_s3_bucket.logs.id; prefix="ext-alb"; enabled=true }
  tags = { Name="${local.name}-ext-alb", Scheme="internet-facing" }
}

resource "aws_lb_target_group" "web" {
  name        = "${local.name}-web-tg"
  port        = 80
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"
  health_check { path="/health"; interval=30; timeout=5; healthy_threshold=2; unhealthy_threshold=3; matcher="200-299" }
  stickiness   { type="lb_cookie"; cookie_duration=86400; enabled=true }
  deregistration_delay = 30
  tags = { Name="${local.name}-web-tg" }
}

resource "aws_lb_listener" "ext_http" {
  load_balancer_arn = aws_lb.external.arn
  port="80"; protocol="HTTP"
  default_action { type="redirect"; redirect { port="443"; protocol="HTTPS"; status_code="HTTP_301" } }
}

resource "aws_lb_listener" "ext_https" {
  load_balancer_arn = aws_lb.external.arn
  port="443"; protocol="HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_cert_arn
  default_action { type="forward"; target_group_arn=aws_lb_target_group.web.arn }
}

# ─────────────────────────────────────────────
# INTERNAL ALB  (Private, APP subnets)
# ─────────────────────────────────────────────
resource "aws_lb" "internal" {
  name               = "${local.name}-int-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.int_alb.id]
  subnets            = aws_subnet.private[*].id
  enable_deletion_protection       = true
  enable_cross_zone_load_balancing = true
  drop_invalid_header_fields       = true
  access_logs { bucket=aws_s3_bucket.logs.id; prefix="int-alb"; enabled=true }
  tags = { Name="${local.name}-int-alb", Scheme="internal" }
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name}-app-tg"
  port        = 5000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "instance"
  health_check { path="/health"; port="5000"; interval=30; timeout=5; healthy_threshold=2; unhealthy_threshold=3; matcher="200-299" }
  stickiness   { type="lb_cookie"; cookie_duration=86400; enabled=true }
  deregistration_delay = 30
  tags = { Name="${local.name}-app-tg" }
}

resource "aws_lb_listener" "int_http" {
  load_balancer_arn = aws_lb.internal.arn
  port="80"; protocol="HTTP"
  default_action { type="forward"; target_group_arn=aws_lb_target_group.app.arn }
}

# ─────────────────────────────────────────────
# WEB TIER LAUNCH TEMPLATE + ASG
# ─────────────────────────────────────────────
resource "aws_launch_template" "web" {
  name_prefix   = "${local.name}-web-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.web_instance_type
  key_name      = var.key_name

  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   { name = aws_iam_instance_profile.ec2.name }

  user_data = base64encode(templatefile("${path.module}/../scripts/userdata.sh", {
    INSTANCE_TIER        = "web"
    S3_FRONTEND_BUCKET   = aws_s3_bucket.frontend.id
    S3_BACKEND_BUCKET       = aws_s3_bucket.backend.id
    INTERNAL_ALB_DNS     = aws_lb.internal.dns_name
    AWS_REGION           = var.aws_region
    SECRET_KEY           = var.flask_secret_key
    MYSQL_HOST           = ""
    MYSQL_USER           = ""
    MYSQL_PASSWORD       = ""
    MYSQL_DB             = ""
    GMAIL_ADDRESS        = ""
    GMAIL_APP_PASSWORD   = ""
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret
    GOOGLE_REDIRECT_URI  = var.google_redirect_uri
  }))

  monitoring { enabled = true }
  metadata_options { http_endpoint="enabled"; http_tokens="required"; http_put_response_hop_limit=1 }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs { volume_size=20; volume_type="gp3"; encrypted=true; delete_on_termination=true }
  }

  tag_specifications {
    resource_type = "instance"
    tags = { Name="${local.name}-web-instance", Tier="Web" }
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_autoscaling_group" "web" {
  name                = "${local.name}-web-asg"
  vpc_zone_identifier = aws_subnet.private[*].id
  target_group_arns   = [aws_lb_target_group.web.arn]
  min_size            = var.web_min
  max_size            = var.web_max
  desired_capacity    = var.web_desired
  health_check_type         = "ELB"
  health_check_grace_period = 120
  default_cooldown          = 120

  launch_template { id=aws_launch_template.web.id; version="$Latest" }
  instance_refresh { strategy="Rolling"; preferences { min_healthy_percentage=50; instance_warmup=120 } }

  dynamic "tag" {
    for_each = { Name="${local.name}-web", Project=var.project, Tier="Web" }
    content { key=tag.key; value=tag.value; propagate_at_launch=true }
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_autoscaling_policy" "web_out" {
  name                   = "${local.name}-web-scale-out"
  autoscaling_group_name = aws_autoscaling_group.web.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = 1
  cooldown               = 180
}
resource "aws_cloudwatch_metric_alarm" "web_cpu_high" {
  alarm_name          = "${local.name}-web-cpu-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2; metric_name="CPUUtilization"; namespace="AWS/EC2"
  period=60; statistic="Average"; threshold=70
  alarm_actions       = [aws_autoscaling_policy.web_out.arn]
  dimensions          = { AutoScalingGroupName=aws_autoscaling_group.web.name }
}
resource "aws_autoscaling_policy" "web_in" {
  name                   = "${local.name}-web-scale-in"
  autoscaling_group_name = aws_autoscaling_group.web.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = -1
  cooldown               = 300
}
resource "aws_cloudwatch_metric_alarm" "web_cpu_low" {
  alarm_name          = "${local.name}-web-cpu-low"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 3; metric_name="CPUUtilization"; namespace="AWS/EC2"
  period=60; statistic="Average"; threshold=30
  alarm_actions       = [aws_autoscaling_policy.web_in.arn]
  dimensions          = { AutoScalingGroupName=aws_autoscaling_group.web.name }
}

# ─────────────────────────────────────────────
# APP TIER LAUNCH TEMPLATE + ASG
# ─────────────────────────────────────────────
resource "aws_launch_template" "app" {
  name_prefix   = "${local.name}-app-"
  image_id      = data.aws_ami.al2023.id
  instance_type = var.app_instance_type
  key_name      = var.key_name

  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   { name = aws_iam_instance_profile.ec2.name }

  user_data = base64encode(templatefile("${path.module}/../scripts/userdata.sh", {
    INSTANCE_TIER        = "app"
    S3_BACKEND_BUCKET       = aws_s3_bucket.backend.id
    S3_FRONTEND_BUCKET   = aws_s3_bucket.frontend.id
    INTERNAL_ALB_DNS     = aws_lb.internal.dns_name
    AWS_REGION           = var.aws_region
    SECRET_KEY           = var.flask_secret_key
    MYSQL_HOST           = aws_db_instance.primary.endpoint
    MYSQL_USER           = var.db_user
    MYSQL_PASSWORD       = var.db_password
    MYSQL_DB             = var.db_name
    GMAIL_ADDRESS        = ""
    GMAIL_APP_PASSWORD   = ""
    GOOGLE_CLIENT_ID     = var.google_client_id
    GOOGLE_CLIENT_SECRET = var.google_client_secret
    GOOGLE_REDIRECT_URI  = var.google_redirect_uri
  }))

  monitoring { enabled = true }
  metadata_options { http_endpoint="enabled"; http_tokens="required"; http_put_response_hop_limit=1 }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs { volume_size=30; volume_type="gp3"; encrypted=true; delete_on_termination=true }
  }

  tag_specifications {
    resource_type = "instance"
    tags = { Name="${local.name}-app-instance", Tier="App" }
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_autoscaling_group" "app" {
  name                = "${local.name}-app-asg"
  vpc_zone_identifier = aws_subnet.private[*].id
  target_group_arns   = [aws_lb_target_group.app.arn]
  min_size            = var.app_min
  max_size            = var.app_max
  desired_capacity    = var.app_desired
  health_check_type         = "ELB"
  health_check_grace_period = 180
  default_cooldown          = 120

  launch_template { id=aws_launch_template.app.id; version="$Latest" }
  instance_refresh { strategy="Rolling"; preferences { min_healthy_percentage=50; instance_warmup=180 } }

  dynamic "tag" {
    for_each = { Name="${local.name}-app", Project=var.project, Tier="App" }
    content { key=tag.key; value=tag.value; propagate_at_launch=true }
  }

  lifecycle { create_before_destroy = true }
  depends_on = [aws_db_instance.primary]
}

resource "aws_autoscaling_policy" "app_out" {
  name                   = "${local.name}-app-scale-out"
  autoscaling_group_name = aws_autoscaling_group.app.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = 1; cooldown=180
}
resource "aws_cloudwatch_metric_alarm" "app_cpu_high" {
  alarm_name          = "${local.name}-app-cpu-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2; metric_name="CPUUtilization"; namespace="AWS/EC2"
  period=60; statistic="Average"; threshold=70
  alarm_actions       = [aws_autoscaling_policy.app_out.arn]
  dimensions          = { AutoScalingGroupName=aws_autoscaling_group.app.name }
}
resource "aws_autoscaling_policy" "app_in" {
  name                   = "${local.name}-app-scale-in"
  autoscaling_group_name = aws_autoscaling_group.app.name
  adjustment_type        = "ChangeInCapacity"
  scaling_adjustment     = -1; cooldown=300
}
resource "aws_cloudwatch_metric_alarm" "app_cpu_low" {
  alarm_name          = "${local.name}-app-cpu-low"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 3; metric_name="CPUUtilization"; namespace="AWS/EC2"
  period=60; statistic="Average"; threshold=30
  alarm_actions       = [aws_autoscaling_policy.app_in.arn]
  dimensions          = { AutoScalingGroupName=aws_autoscaling_group.app.name }
}

# ─────────────────────────────────────────────
# RDS MYSQL  (Multi-AZ Primary + Read Replica)
# ─────────────────────────────────────────────
resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnet-group"
  subnet_ids = aws_subnet.db[*].id
  tags       = { Name="${local.name}-db-subnet-group" }
}

resource "aws_db_parameter_group" "mysql8" {
  family = "mysql8.0"
  name   = "${local.name}-mysql8-params"
  parameter { name="character_set_server";    value="utf8mb4" }
  parameter { name="character_set_client";    value="utf8mb4" }
  parameter { name="collation_server";        value="utf8mb4_unicode_ci" }
  parameter { name="max_connections";         value="500" }
  parameter { name="slow_query_log";          value="1" }
  parameter { name="long_query_time";         value="2" }
  tags = { Name="${local.name}-mysql8-params" }
}

resource "aws_db_instance" "primary" {
  identifier        = "${local.name}-mysql-primary"
  engine            = "mysql"
  engine_version    = "8.0.39"
  instance_class    = var.db_instance_class
  db_name           = var.db_name
  username          = var.db_user
  password          = var.db_password

  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_type          = "gp3"
  storage_encrypted     = true
  iops                  = 3000

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  port                   = 3306
  multi_az               = true

  parameter_group_name    = aws_db_parameter_group.mysql8.name
  backup_retention_period = 7
  backup_window           = "02:00-03:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot   = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${local.name}-final-snapshot"
  deletion_protection     = true
  auto_minor_version_upgrade = true

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports = ["error","general","slowquery"]
  performance_insights_enabled    = true
  performance_insights_retention_period = 7

  tags = { Name="${local.name}-mysql-primary", Role="Primary" }
}

resource "aws_db_instance" "replica" {
  count               = var.create_replica ? 1 : 0
  identifier          = "${local.name}-mysql-replica"
  replicate_source_db = aws_db_instance.primary.identifier
  instance_class      = var.db_instance_class
  publicly_accessible = false
  vpc_security_group_ids = [aws_security_group.db.id]
  storage_encrypted   = true
  storage_type        = "gp3"
  iops                = 3000
  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
  skip_final_snapshot          = true
  tags = { Name="${local.name}-mysql-replica", Role="ReadReplica" }
}

resource "aws_iam_role" "rds_monitoring" {
  name = "${local.name}-rds-monitoring"
  assume_role_policy = jsonencode({ Version="2012-10-17", Statement=[{ Effect="Allow", Principal={Service="monitoring.rds.amazonaws.com"}, Action="sts:AssumeRole" }] })
}
resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# ─────────────────────────────────────────────
# ROUTE 53
# ─────────────────────────────────────────────
resource "aws_route53_zone" "main" {
  count = var.create_hosted_zone ? 1 : 0
  name  = var.domain
  tags  = { Name="${local.name}-zone" }
}

resource "aws_route53_record" "apex" {
  count   = var.create_hosted_zone ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = var.domain
  type    = "A"
  alias {
    name                   = aws_lb.external.dns_name
    zone_id                = aws_lb.external.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "www" {
  count   = var.create_hosted_zone ? 1 : 0
  zone_id = aws_route53_zone.main[0].zone_id
  name    = "www.${var.domain}"
  type    = "A"
  alias {
    name                   = aws_lb.external.dns_name
    zone_id                = aws_lb.external.zone_id
    evaluate_target_health = true
  }
}

# ─────────────────────────────────────────────
# CLOUDWATCH ALARMS + DASHBOARD
# ─────────────────────────────────────────────
resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2; metric_name="CPUUtilization"; namespace="AWS/RDS"
  period=300; statistic="Average"; threshold=80
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions          = { DBInstanceIdentifier=aws_db_instance.primary.identifier }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.name}-rds-storage-low"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 1; metric_name="FreeStorageSpace"; namespace="AWS/RDS"
  period=300; statistic="Average"; threshold=10737418240
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions          = { DBInstanceIdentifier=aws_db_instance.primary.identifier }
}

resource "aws_cloudwatch_metric_alarm" "ext_alb_5xx" {
  alarm_name          = "${local.name}-ext-alb-5xx"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2; metric_name="HTTPCode_ELB_5XX_Count"; namespace="AWS/ApplicationELB"
  period=60; statistic="Sum"; threshold=10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions          = { LoadBalancer=aws_lb.external.arn_suffix }
}

resource "aws_cloudwatch_metric_alarm" "int_alb_5xx" {
  alarm_name          = "${local.name}-int-alb-5xx"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 2; metric_name="HTTPCode_ELB_5XX_Count"; namespace="AWS/ApplicationELB"
  period=60; statistic="Sum"; threshold=10
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  dimensions          = { LoadBalancer=aws_lb.internal.arn_suffix }
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${local.name}-dashboard"
  dashboard_body = jsonencode({
    widgets = [
      { type="metric", x=0, y=0, width=12, height=6, properties={ title="External ALB Requests", metrics=[["AWS/ApplicationELB","RequestCount","LoadBalancer",aws_lb.external.arn_suffix]], period=60, stat="Sum", view="timeSeries" } },
      { type="metric", x=12,y=0, width=12, height=6, properties={ title="Internal ALB Requests", metrics=[["AWS/ApplicationELB","RequestCount","LoadBalancer",aws_lb.internal.arn_suffix]], period=60, stat="Sum", view="timeSeries" } },
      { type="metric", x=0, y=6, width=12, height=6, properties={ title="Web ASG CPU", metrics=[["AWS/EC2","CPUUtilization","AutoScalingGroupName",aws_autoscaling_group.web.name]], period=60, stat="Average", view="timeSeries" } },
      { type="metric", x=12,y=6, width=12, height=6, properties={ title="App ASG CPU", metrics=[["AWS/EC2","CPUUtilization","AutoScalingGroupName",aws_autoscaling_group.app.name]], period=60, stat="Average", view="timeSeries" } },
      { type="metric", x=0, y=12,width=12, height=6, properties={ title="RDS CPU", metrics=[["AWS/RDS","CPUUtilization","DBInstanceIdentifier",aws_db_instance.primary.identifier]], period=60, stat="Average", view="timeSeries" } },
      { type="metric", x=12,y=12,width=12, height=6, properties={ title="RDS Connections", metrics=[["AWS/RDS","DatabaseConnections","DBInstanceIdentifier",aws_db_instance.primary.identifier]], period=60, stat="Average", view="timeSeries" } }
    ]
  })
}
