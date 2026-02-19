variable "aws_region" {
  description = "AWS region for RDS instance"
  type        = string
  default     = "us-east-1"
}

variable "db_instance_class" {
  description = "RDS instance class (db.t3.micro for free tier)"
  type        = string
  default     = "db.t3.micro"
}

variable "db_name" {
  description = "PostgreSQL database name"
  type        = string
  default     = "flight_points"
}

variable "db_username" {
  description = "Master database username"
  type        = string
  default     = "flightadmin"
}

variable "db_password" {
  description = "Master database password"
  type        = string
  sensitive   = true
}

variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to connect to PostgreSQL"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
