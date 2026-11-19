# Amazon SES identities for the reveal code email.
#
# The sender is verified either as a whole domain (recommended: mail is far
# less likely to land in spam) or as a single address. For a domain, the three
# DKIM records go into its DNS: Terraform writes them itself when the domain's
# hosted zone is in Route 53 in this account, otherwise add them by hand from
# the `dkim_records` output. While the account is in the SES sandbox,
# recipients must be verified too: SES emails each of them a confirmation link.
#
# SES identities belong to the AWS account, not to one environment. A second
# environment in the same account (prod next to dev) sets
# manage_identities = false and reuses the identities the first one created;
# the plan then fails unless they exist and are verified for sending.

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
  for_each       = var.manage_identities ? local.identities : toset([])
  email_identity = each.value
}

# Reused identities (manage_identities = false): they must already be there and verified.
data "aws_sesv2_email_identity" "existing" {
  for_each       = var.manage_identities ? toset([]) : local.identities
  email_identity = each.value

  lifecycle {
    postcondition {
      condition     = self.verified_for_sending_status
      error_message = "The SES identity ${each.value} isn't verified for sending yet. Verify it (in the environment that manages it) before this one uses it."
    }
  }
}

# The DKIM tokens are read back through the data source: it exposes them as a
# plain attribute (the resource keeps them in a nested block).
data "aws_sesv2_email_identity" "sender_domain" {
  count          = var.sender_domain != "" ? 1 : 0
  email_identity = var.manage_identities ? aws_sesv2_email_identity.this[var.sender_domain].email_identity : var.sender_domain
}

locals {
  dkim_tokens = var.sender_domain != "" ? data.aws_sesv2_email_identity.sender_domain[0].dkim_signing_attributes[0].tokens : []
  # Easy DKIM always issues exactly three tokens. Counting them up front keeps
  # the plan known before the identity exists (for_each over them could not).
  # Only the environment that manages the identities writes their records.
  dkim_record_count = var.sender_domain != "" && var.manage_dns_records && var.manage_identities ? 3 : 0
  identity_arns = var.manage_identities ? [for identity in aws_sesv2_email_identity.this : identity.arn] : [
    for identity in data.aws_sesv2_email_identity.existing : identity.arn
  ]
}

data "aws_route53_zone" "sender" {
  count        = local.dkim_record_count > 0 ? 1 : 0
  name         = var.sender_domain
  private_zone = false
}

resource "aws_route53_record" "dkim" {
  count   = local.dkim_record_count
  zone_id = data.aws_route53_zone.sender[0].zone_id
  name    = "${local.dkim_tokens[count.index]}._domainkey.${var.sender_domain}"
  type    = "CNAME"
  ttl     = 1800
  records = ["${local.dkim_tokens[count.index]}.dkim.amazonses.com"]
}
