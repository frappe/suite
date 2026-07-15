import os
import tarfile
import zipfile

import frappe
from frappe import _


def extract_compressed_file(file_path: str, destination: str) -> None:
	"""Extract a .zip, .tar.gz, or .tgz archive safely."""

	def is_within_directory(base_path, target_path) -> bool:
		"""Ensure target_path is inside base_path"""

		base_path = os.path.abspath(base_path)
		target_path = os.path.abspath(target_path)
		return os.path.commonpath([base_path]) == os.path.commonpath([base_path, target_path])

	def safe_extract_zip(archive, destination) -> None:
		"""Safely extract ZIP files, preventing path traversal."""

		for member in archive.namelist():
			member_path = os.path.join(destination, member)
			if not is_within_directory(destination, member_path):
				frappe.throw(_("Unsafe file path detected: {0}").format(member))
		archive.extractall(destination)

	def safe_extract_tar(archive, destination) -> None:
		"""Safely extract TAR files, preventing path traversal."""

		for member in archive.getmembers():
			member_path = os.path.join(destination, member.name)
			if not is_within_directory(destination, member_path):
				frappe.throw(_("Unsafe file path detected: {0}").format(member.name))
		archive.extractall(destination)

	if not os.path.exists(file_path):
		frappe.throw(_("File not found: {0}").format(file_path))

	if not os.path.exists(destination):
		os.makedirs(destination, exist_ok=True)

	if file_path.endswith(".zip"):
		with zipfile.ZipFile(file_path, "r") as archive:
			safe_extract_zip(archive, destination)

	elif file_path.endswith((".tar.gz", ".tgz")):
		with tarfile.open(file_path, "r:gz") as archive:
			safe_extract_tar(archive, destination)

	else:
		frappe.throw(_("Unsupported file format: {0}").format(file_path))


def compress_directory(source_dir: str, output_path: str) -> None:
	"""Compress a directory into .zip, .tgz, or .tar.gz format based on output file extension."""

	if output_path.endswith(".zip"):
		with zipfile.ZipFile(output_path, "w", compression=zipfile.ZIP_DEFLATED) as zip_file:
			for root, _dirs, files in os.walk(source_dir):
				for file in files:
					file_path = os.path.join(root, file)
					relative_path = os.path.relpath(file_path, source_dir)
					zip_file.write(file_path, relative_path)

	elif output_path.endswith(".tgz") or output_path.endswith(".tar.gz"):
		with tarfile.open(output_path, "w:gz") as tar_file:
			tar_file.add(source_dir, arcname=".")

	else:
		frappe.throw(_("Unsupported output file format. Supported formats are .zip, .tgz, and .tar.gz."))
