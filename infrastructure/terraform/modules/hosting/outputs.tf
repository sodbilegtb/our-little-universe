output "app_id" {
  value = aws_amplify_app.web.id
}

output "branch_name" {
  value = aws_amplify_branch.main.branch_name
}

output "url" {
  description = "Public URL of the web app."
  value       = "https://${aws_amplify_branch.main.branch_name}.${aws_amplify_app.web.default_domain}"
}
