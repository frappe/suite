"""Documented Drive workflow failures."""

import frappe


class DriveError(frappe.ValidationError):
    http_status_code = 400


class DriveNotFound(DriveError):
    http_status_code = 404


class DriveForbidden(DriveError):
    http_status_code = 403


class DriveLocked(DriveError):
    http_status_code = 401


class DriveLinkExpired(DriveError):
    http_status_code = 410


class DriveOverQuota(DriveError):
    http_status_code = 413


class DriveConflict(DriveError):
    http_status_code = 409
