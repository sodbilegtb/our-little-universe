# Amazon SES identities for the reveal code email.
#
# The sender is verified either as a whole domain (recommended: add the DKIM
# records from the outputs to your DNS, and mail is far less likely to land in
# spam) or as a single address. While the account is in the SES sandbox,
# recipients must be verified too: SES emails each of them a confirmation link.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

locals {
  sender_identity = var.sender_domain != "" ? var.sender_domain : var.sender_address
  identities = toset(compact(concat(
    [local.sender_identity],
    var.verify_recipients ? var.recipient_addresses : [],
  )))
}

resource "aws_sesv2_email_identity" "this" {
  for_each       = local.identities
  email_identity = each.value
}
