terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }

  # Remote state in the bootstrap bucket. Bucket and region come from
  # backend.hcl: terraform init -backend-config=backend.hcl
  backend "s3" {
    key          = "prod/terraform.tfstate"
    encrypt      = true
    use_lockfile = true # S3-native state locking, no DynamoDB lock table needed
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "our-little-universe"
      Environment = local.environment
      ManagedBy   = "terraform"
    }
  }
}
