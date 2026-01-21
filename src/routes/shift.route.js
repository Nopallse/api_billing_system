const express = require("express");
const router = express.Router();
const {
    startShift,
    endShift,
    getShiftStatus,
    getShiftReport,
    getShiftHistory,
    getShiftTransactions,
    getIncomeSummaryByDate,
    markShiftsAsWithdrawn
} = require("../controllers/shift.controller");
const { tokenValidation } = require("../middlewares/auth.middleware");

// Mulai shift baru
router.post("/start", tokenValidation, startShift);

// Tutup shift
router.post("/end", tokenValidation, endShift);

// Tandai shift sebagai sudah ditarik
router.patch("/withdraw", tokenValidation, markShiftsAsWithdrawn);

// Cek status shift saat ini
router.get("/status", tokenValidation, getShiftStatus);

// Riwayat shift
router.get("/history", tokenValidation, getShiftHistory);

// Summary pendapatan per tanggal (harus sebelum route dengan parameter)
router.get("/summary/by-date", tokenValidation, getIncomeSummaryByDate);

// Transaksi dalam shift tertentu (harus sebelum /:shiftId/report)
router.get("/:shiftId/transactions", tokenValidation, getShiftTransactions);

// Laporan shift berdasarkan ID
router.get("/:shiftId/report", tokenValidation, getShiftReport);

module.exports = router;
