const express = require('express');
const router = express.Router();
const {tokenValidation, verifyAdmin} = require('../middlewares/auth.middleware');
const {createCategory, getAllCategories, getCategoryById, updateCategory, deleteCategory} = require('../controllers/category.controller');


router.post('/create', tokenValidation, verifyAdmin, createCategory);
router.get('/', tokenValidation, getAllCategories);
router.get('/:id', tokenValidation, getCategoryById);
router.put('/update/:id', tokenValidation, verifyAdmin, updateCategory);
router.delete('/delete/:id', tokenValidation, deleteCategory);
module.exports = router;