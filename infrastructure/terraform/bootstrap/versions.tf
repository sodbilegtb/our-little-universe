terraform {
  required_version = ">= 1.11.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # The bootstrap keeps its own state locally on purpose: it creates the bucket
  # that every other configuration stores its state in. Keep terraform.tfstate
  # from this folder somewhere safe (it is not committed to Git).
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "our-little-universe"
      Component = "terraform-state"
      ManagedBy = "terraform"
    }
  }
}
