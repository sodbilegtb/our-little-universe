mock_provider "aws" {
  mock_resource "aws_sesv2_email_identity" {
    defaults = { arn = "arn:aws:ses:eu-central-1:123456789012:identity/example" }
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
