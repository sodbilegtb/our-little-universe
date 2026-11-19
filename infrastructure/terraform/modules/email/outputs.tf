output "identity_arns" {
  description = "Identities the mailer may send as (and to, in the sandbox)."
  value       = [for identity in aws_sesv2_email_identity.this : identity.arn]
}

output "dkim_records" {
  description = "CNAME records to add to the sender domain's DNS (empty when verifying a single address)."
  value = var.sender_domain == "" ? [] : [
    for token in aws_sesv2_email_identity.this[var.sender_domain].dkim_signing_attributes[0].tokens : {
      name  = "${token}._domainkey.${var.sender_domain}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}
