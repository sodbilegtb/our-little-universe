output "api_endpoint" {
  description = "Base URL of the API (set as VITE_API_BASE_URL for the web build)."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "api_id" {
  value = aws_apigatewayv2_api.http.id
}

output "function_name" {
  value = aws_lambda_function.api.function_name
}

output "lambda_log_group" {
  value = aws_cloudwatch_log_group.lambda.name
}

output "access_log_group" {
  value = aws_cloudwatch_log_group.access.name
}

output "throttling" {
  description = "The stage's request limits."
  value = {
    rate  = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_rate_limit
    burst = aws_apigatewayv2_stage.default.default_route_settings[0].throttling_burst_limit
  }
}
