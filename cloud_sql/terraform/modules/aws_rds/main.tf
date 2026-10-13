variable "nombre" { type = string }
variable "db_nombre" { type = string }
variable "db_usuario" { type = string }
variable "password" {
  type      = string
  sensitive = true
}
variable "clase" { type = string }
variable "almacenamiento_gb" { type = number }
variable "cidrs_permitidos" { type = list(string) }

data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_db_subnet_group" "esta" {
  name       = var.nombre
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name        = "${var.nombre}-pg"
  description = "PostgreSQL de Vigia Peru (TLS obligatorio; ver cidrs_permitidos)"
  vpc_id      = data.aws_vpc.default.id
  # Las reglas de ingreso van como recursos aparte (abajo y en el módulo raíz): mezclarlas con bloques
  # `ingress` inline haría que Terraform borre las que se agregan por fuera.
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_vpc_security_group_ingress_rule" "cidr" {
  for_each          = toset(var.cidrs_permitidos)
  security_group_id = aws_security_group.db.id
  cidr_ipv4         = each.value
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
  description       = "IP fija permitida"
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${var.nombre}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "500"
  }
  parameter {
    name         = "shared_preload_libraries"
    value        = "pg_stat_statements,pgaudit"
    apply_method = "pending-reboot"
  }
  # Auditoría: quién se conecta y qué cambia el esquema o los roles (no registra cada SELECT).
  parameter {
    name  = "log_connections"
    value = "1"
  }
  parameter {
    name  = "log_disconnections"
    value = "1"
  }
  parameter {
    name  = "pgaudit.log"
    value = "ddl,role"
  }
}

resource "aws_db_instance" "esta" {
  identifier                   = var.nombre
  engine                       = "postgres"
  engine_version               = "16.15" # misma versión que Cloud SQL
  instance_class               = var.clase
  allocated_storage            = var.almacenamiento_gb
  max_allocated_storage        = 100
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = var.db_nombre
  username                     = var.db_usuario
  password                     = var.password
  db_subnet_group_name         = aws_db_subnet_group.esta.name
  vpc_security_group_ids       = [aws_security_group.db.id]
  parameter_group_name         = aws_db_parameter_group.pg16.name
  publicly_accessible          = true
  multi_az                     = false
  backup_retention_period      = 7
  backup_window                = "08:00-09:00"
  copy_tags_to_snapshot        = true
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${var.nombre}-final"
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  performance_insights_enabled = false
  auto_minor_version_upgrade   = true
  apply_immediately            = true
}

resource "aws_ssm_parameter" "password" {
  name  = "/vigia/${var.nombre}/password"
  type  = "SecureString"
  value = var.password
}

output "host" { value = aws_db_instance.esta.address }
output "sg_id" { value = aws_security_group.db.id }
output "ssm_parametro" { value = aws_ssm_parameter.password.name }
