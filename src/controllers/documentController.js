const { uploadDocuments } = require("../helpers/documentHelper");
const { deleteDocuments } = require("../helpers/documentHelper");
const WithDataResource = require("../resources/WithDataResource");
const WithoutDataResource = require("../resources/WithoutDataResource");

exports.uploadDocuments = async (req, res) => {
  try {
    const files = req.files;
    const uploadedBy = req.user?.id || 1;

    if (!files || files.length === 0) {
      const response = new WithoutDataResource(
        400,
        "NO_FILES",
        "Gagal Upload Dokumen",
        "Tidak ada file yang dikirim. Silakan pilih dokumen terlebih dahulu."
      );
      return res.status(400).json(response.toResponse());
    }

    const result = await uploadDocuments(files, uploadedBy);

    const response = new WithDataResource(
      201,
      "UPLOAD_SUCCESS",
      "Upload Berhasil",
      "Dokumen berhasil diunggah ke server.",
      result
    );
    return res.status(201).json(response.toResponse());
  } catch (error) {
    logger.error(`| Upload Documents | - Server error: ${error.message}`, {
      stack: error.stack,
    });
    const response = new WithoutDataResource(
      500, // HTTP Status Code: Internal Server Error
      "SERVER_ERROR",
      "Login Gagal.",
      "Terjadi kesalahan di server. Silakan coba lagi nanti."
    );
    res.status(500).json(response.toResponse());
  }
};

exports.deleteDocuments = async (req, res) => {
  try {
    const { document_ids } = req.body;

    if (!Array.isArray(document_ids) || document_ids.length === 0) {
      const response = new WithoutDataResource(
        400,
        "INVALID_INPUT",
        "Gagal Menghapus Dokumen",
        "Mohon kirimkan document_ids yang valid."
      );
      return res.status(400).json(response.toResponse());
    }

    const deleted = await deleteDocuments(document_ids);

    if (deleted.length === 0) {
      const response = new WithoutDataResource(
        404,
        "NO_DOCUMENT_DELETED",
        "Dokumen Tidak Ditemukan",
        "Tidak ada dokumen yang berhasil dihapus."
      );
      return res.status(404).json(response.toResponse());
    }

    const response = new WithoutDataResource(
      200,
      "DELETE_SUCCESS",
      "Dokumen Berhasil Dihapus",
      "Beberapa dokumen berhasil dihapus dari sistem."
    );
    return res.status(200).json(response.toResponse());
  } catch (error) {
    logger.error(`| deleteDocuments | - Server error: ${error.message}`, {
      stack: error.stack,
    });
    const response = new WithoutDataResource(
      500,
      "SERVER_ERROR",
      "Gagal Menghapus Dokumen",
      "Terjadi kesalahan di server. Silakan coba lagi nanti."
    );
    return res.status(500).json(response.toResponse());
  }
};
