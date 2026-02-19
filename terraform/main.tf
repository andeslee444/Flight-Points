terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# ── Default VPC + Subnets (data sources, no new VPC) ──

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ── Security Group ──

resource "aws_security_group" "rds" {
  name_prefix = "flight-points-rds-"
  description = "Allow PostgreSQL access from allowed CIDRs"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = var.allowed_cidr_blocks
    description = "PostgreSQL from allowed CIDRs"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
    description = "Allow all outbound"
  }

  tags = {
    Name    = "flight-points-rds"
    Project = "flight-points"
  }
}

# ── DB Subnet Group ──

resource "aws_db_subnet_group" "main" {
  name       = "flight-points"
  subnet_ids = data.aws_subnets.default.ids

  tags = {
    Name    = "flight-points"
    Project = "flight-points"
  }
}

# ── DB Parameter Group (slow query logging) ──

resource "aws_db_parameter_group" "postgres16" {
  name   = "flight-points-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  tags = {
    Project = "flight-points"
  }
}

# ── RDS Instance ──

resource "aws_db_instance" "main" {
  identifier     = "flight-points"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class
  allocated_storage = 20
  storage_type      = "gp3"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.postgres16.name

  publicly_accessible    = true
  multi_az               = false
  skip_final_snapshot    = true
  deletion_protection    = false
  storage_encrypted      = true
  backup_retention_period = 1

  tags = {
    Name    = "flight-points"
    Project = "flight-points"
  }
}
