# Proxy de base de datos dentro de la VPC de AWS: PgBouncer + túnel de Cloudflare (cloudflared).
#
#   Workers (API, MCP, dispatcher) → Hyperdrive → Workers VPC → túnel Cloudflare → ESTE host → PgBouncer → RDS
#
# · Sin puertos de entrada: el grupo de seguridad no tiene reglas de ingreso. El túnel es conexión SALIENTE.
# · Sin SSH: se entra solo por AWS Systems Manager (sesión SSM), con IAM.
# · PgBouncer habla con RDS por TLS verificando el certificado (bundle global de RDS).
# · Los secretos (lista de usuarios de PgBouncer y token del túnel) viven en SSM Parameter Store y NO en Terraform:
#     /vigia/proxy/userlist       contenido de userlist.txt
#     /vigia/proxy/tunnel-token   token del túnel `vigia-db`
#   Se cargan con cloud_sql/archivos/preparar_proxy.sh.

variable "nombre" { type = string }
variable "rds_host" { type = string }
variable "clase" {
  type    = string
  default = "t4g.micro"
}

data "aws_vpc" "default" { default = true }
data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}
data "aws_ssm_parameter" "ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_security_group" "proxy" {
  name        = "${var.nombre}-proxy"
  description = "Proxy de base de datos: sin ingreso (tunel saliente + SSM)"
  vpc_id      = data.aws_vpc.default.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_iam_policy_document" "asume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "proxy" {
  name               = "${var.nombre}-proxy"
  assume_role_policy = data.aws_iam_policy_document.asume.json
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.proxy.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_caller_identity" "yo" {}
data "aws_region" "aqui" {}

resource "aws_iam_role_policy" "secretos" {
  name = "leer-secretos-proxy"
  role = aws_iam_role.proxy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter"]
      Resource = "arn:aws:ssm:${data.aws_region.aqui.name}:${data.aws_caller_identity.yo.account_id}:parameter/vigia/proxy/*"
    }]
  })
}

resource "aws_iam_instance_profile" "proxy" {
  name = "${var.nombre}-proxy"
  role = aws_iam_role.proxy.name
}

resource "aws_instance" "proxy" {
  ami                         = data.aws_ssm_parameter.ami.value
  instance_type               = var.clase
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.proxy.id]
  iam_instance_profile        = aws_iam_instance_profile.proxy.name
  associate_public_ip_address = true # solo para salir a internet (cloudflared, SSM); no entra nada
  metadata_options {
    http_tokens   = "required" # IMDSv2
    http_endpoint = "enabled"
  }
  root_block_device {
    volume_size = 8
    volume_type = "gp3"
    encrypted   = true
  }
  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/arranque.sh.tftpl", {
    rds_host = var.rds_host
    region   = data.aws_region.aqui.name
  })
  tags = { Name = "${var.nombre}-proxy" }

  # La AMI sale de un parámetro SSM que AWS actualiza solo: sin esto, cualquier `terraform apply` reemplazaba el proxy
  # (corte de la base para los Workers y se pierde la base `vigia_dev` de PgBouncer, ver docs/DEV.md). Para actualizar
  # el sistema operativo: `terraform apply -replace=module.proxy[0].aws_instance.proxy` a propósito.
  lifecycle {
    ignore_changes = [ami]
  }
}

output "sg_id" { value = aws_security_group.proxy.id }
output "instancia" { value = aws_instance.proxy.id }
