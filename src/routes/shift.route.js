const express = require("express");
const router = express.Router();
const {
    startShift,
    endShift,
    getShiftStatus,
    getShiftReport,
    getShiftHistory
} = require("../controllers/shift.controller");
const { tokenValidation } = require("../middlewares/auth.middleware");

// Mulai shift baru
router.post("/start", tokenValidation, startShift);

// Tutup shift
router.post("/end", tokenValidation, endShift);

// Cek status shift saat ini
router.get("/status", tokenValidation, getShiftStatus);

// Riwayat shift
router.get("/history", tokenValidation, getShiftHistory);

// Laporan shift berdasarkan ID
router.get("/:shiftId/report", tokenValidation, getShiftReport);

module.exports = router;
