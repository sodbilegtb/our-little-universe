mock_provider "aws" {
  mock_resource "aws_sesv2_email_identity" {
    defaults = {
      arn = "arn:aws:ses:eu-central-1:123456789012:identity/example"
    }
  }
  mock_data "aws_sesv2_email_identity" {
    defaults = {
      dkim_signing_attributes = [{ tokens = ["tokena", "tokenb", "tokenc"] }]
    }
  }
  mock_data "aws_route53_zone" {
    defaults = { zone_id = "Z0123456789EXAMPLE" }
  }
}

run "address_sender_and_recipients" {
  command = apply

  variables {
    sender_address      = "reveal@example.com"
    recipient_addresses = ["parent@example.com", "partner@example.com"]
  }

  assert {
    condition     = keys(aws_sesv2_email_identity.this) == ["parent@example.com", "partner@example.com", "reveal@example.com"]
    error_message = "The sender and every recipient are verified (SES sandbox)."
  }
}

run "nothing_configured" {
  command = apply

  assert {
    condition     = length(aws_sesv2_email_identity.this) == 0
    error_message = "Without addresses, no identity is created and no mail is sent."
  }
}

run "rejects_invalid_recipient" {
  command = plan

  variables {
    recipient_addresses = ["not an address"]
  }

  expect_failures = [var.recipient_addresses]
}

run "domain_with_route53_dns" {
  command = apply

  variables {
    sender_address      = "reveal@example.com"
    sender_domain       = "example.com"
    recipient_addresses = ["parent@example.com"]
    manage_dns_records  = true
  }

  assert {
    condition     = length(aws_route53_record.dkim) == 3
    error_message = "All three DKIM records are written to the hosted zone."
  }

  assert {
    condition = alltrue([
      for i, r in aws_route53_record.dkim :
      r.type == "CNAME" && r.zone_id == "Z0123456789EXAMPLE" &&
      r.name == "${["tokena", "tokenb", "tokenc"][i]}._domainkey.example.com" &&
      r.records == toset(["${["tokena", "tokenb", "tokenc"][i]}.dkim.amazonses.com"])
    ])
    error_message = "Each record points its DKIM token at amazonses.com."
  }

  assert {
    condition     = output.dns_records_managed
    error_message = "The output says Terraform manages the records."
  }
}

run "domain_without_route53_dns" {
  command = apply

  variables {
    sender_address = "reveal@example.com"
    sender_domain  = "example.com"
  }

  assert {
    condition     = length(aws_route53_record.dkim) == 0 && length(output.dkim_records) == 3
    error_message = "Without manage_dns_records, the records are only listed for adding by hand."
  }
}

run "dns_flag_needs_a_domain" {
  command = apply

  variables {
    sender_address     = "reveal@example.com"
    manage_dns_records = true
  }

  assert {
    condition     = length(aws_route53_record.dkim) == 0
    error_message = "A single sender address has no DKIM records to write."
  }
}
