variable "table_name" {
  description = "Name of the events table, e.g. olu-dev-events."
  type        = string
}

variable "point_in_time_recovery" {
  description = "Keep continuous backups (35 days)."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Block table deletion until this is switched off. Recommended for production."
  type        = bool
  default     = false
}
