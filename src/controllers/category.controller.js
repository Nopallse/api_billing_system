const {Category} = require('../models');
const {v4: uuidv4} = require('uuid');
//tambah Category
const createCategory = async (req, res) => {
    const {categoryName, cost, periode} = req.body;
    try{
        const existingCategory = await Category.findOne({
            where: {
                categoryName
            }
        })
        if(existingCategory){
            return res.status(400).json({
                message: 'Category already exists'
            })
        }
        const categoryId = uuidv4();
        const category = await Category.create({
            id: categoryId,
            categoryName,
            cost,
            periode,
        })
        res.status(201).json({
            message: 'Category created',
            data: category
        })
    }catch(error){
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        })
    }
}

const getAllCategories = async (req, res) => {
    try{
        const categories = await Category.findAll()
        res.status(200).json({
            message: 'Success',
            data: categories
        })
    }catch(error){
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        })
    }
}

const getCategoryById = async (req, res) => {
    const {id} = req.params;
    try{
        const category = await Category.findOne({
            where: {
                id
            }
        })
        if(!category){
            return res.status(404).json({
                message: 'Category not found'
            })
        }
        res.status(200).json({
            message: 'Success',
            data: category
        })
    }catch(error){
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        })
    }
}

const updateCategory = async (req, res) => {
    const {id} = req.params;
    const {categoryName, cost, periode} = req.body;
    try{
        const category = await Category.findOne({
            where: {
                id
            }
        })
        if(!category){
            return res.status(404).json({
                message: 'Category not found'
            })
        }
        //update category
        category.categoryName = categoryName;
        category.cost = cost;
        category.periode = periode;
        await category.save();
        res.status(200).json({
            message: 'Category updated',
            data: category
        })
    }catch(error){
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        })
    }
}
const deleteCategory = async (req, res) => {
    const {id} = req.params;
    try{
        const category = await Category.findOne({
            where: {
                id
            }
        })
        if(!category){
            return res.status(404).json({
                message: 'Category not found'
            })
        }
        await category.destroy();
        res.status(200).json({
            message: 'Category deleted'
        })
    }catch(error){
        res.status(500).json({
            message: 'Internal server error',
            error: error.message
        })
    }
}



module.exports = {
    createCategory,
    getAllCategories,
    getCategoryById,
    updateCategory,
    deleteCategory

}