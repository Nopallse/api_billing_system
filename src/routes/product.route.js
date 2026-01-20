const express = require("express");
const router = express.Router();
const {
    createProduct,
    getAllProducts,
    getProductById,
    updateProduct,
    deleteProduct
} = require("../controllers/product.controller");
const { tokenValidation, verifyAdmin } = require("../middlewares/auth.middleware");

// Get all products (public - no auth required)
router.get("/", getAllProducts);

// Get product by ID (public)
router.get("/:id", getProductById);

// Create product (admin only)
router.post("/", tokenValidation, verifyAdmin, createProduct);

// Update product (admin only)
router.put("/:id", tokenValidation, verifyAdmin, updateProduct);

// Delete product (admin only)
router.delete("/:id", tokenValidation, verifyAdmin, deleteProduct);

module.exports = router;
