output "identity_arns" {
  description = "Identities the mailer may send as (and to, in the sandbox)."
  value       = local.identity_arns
}

output "dkim_records" {
  description = "CNAME records for the sender domain's DNS (written by Terraform when manage_dns_records is on; empty when verifying a single address)."
  value = [
    for token in local.dkim_tokens : {
      name  = "${token}._domainkey.${var.sender_domain}"
      type  = "CNAME"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}

output "dns_records_managed" {
  description = "Whether Terraform wrote the DKIM records itself."
  value       = local.dkim_record_count > 0
}
