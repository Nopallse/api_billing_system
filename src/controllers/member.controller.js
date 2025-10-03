const { Member, Transaction } = require('../models');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');

const memberController = {
  // GET /members - Get all members
  async getAllMembers(req, res) {
    try {
      const { page = 1, limit = 10, search } = req.query;
      const offset = (page - 1) * limit;
      
      const whereClause = {};
      if (search) {
        whereClause[Op.or] = [
          { email: { [Op.iLike]: `%${search}%` } },
          { username: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const { count, rows } = await Member.findAndCountAll({
        where: whereClause,
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['createdAt', 'DESC']],
        include: [{
          model: Transaction,
          as: 'transactions',
          attributes: ['id', 'start', 'end', 'duration', 'cost', 'createdAt']
        }]
      });

      res.status(200).json({
        success: true,
        message: 'Members retrieved successfully',
        data: {
          members: rows,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(count / limit),
            totalItems: count,
            itemsPerPage: parseInt(limit)
          }
        }
      });
    } catch (error) {
      console.error('Error getting members:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve members',
        error: error.message
      });
    }
  },

  // GET /members/:id - Get member by ID
  async getMemberById(req, res) {
    try {
      const { id } = req.params;
      
      const member = await Member.findByPk(id, {
        include: [{
          model: Transaction,
          as: 'transactions',
          attributes: ['id', 'start', 'end', 'duration', 'cost', 'createdAt'],
          order: [['createdAt', 'DESC']]
        }]
      });

      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found'
        });
      }

      res.status(200).json({
        success: true,
        message: 'Member retrieved successfully',
        data: member
      });
    } catch (error) {
      console.error('Error getting member:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to retrieve member',
        error: error.message
      });
    }
  },

  // POST /members - Create new member
  async createMember(req, res) {
    try {
      const { email, username, pin, deposit = 0 } = req.body;

      // Validation
      if (!email || !username || !pin) {
        return res.status(400).json({
          success: false,
          message: 'Email, username, and pin are required'
        });
      }

      // Validate deposit amount
      if (deposit < 0) {
        return res.status(400).json({
          success: false,
          message: 'Deposit amount cannot be negative'
        });
      }

      // Check if email or username already exists
      const existingMember = await Member.findOne({
        where: {
          [Op.or]: [
            { email },
            { username }
          ]
        }
      });

      if (existingMember) {
        return res.status(409).json({
          success: false,
          message: 'Email or username already exists'
        });
      }

      // Hash the pin
      const hashedPin = await bcrypt.hash(pin, 10);

      // Create member
      const member = await Member.create({
        email,
        username,
        pin: hashedPin,
        deposit: parseInt(deposit)
      });

      // Remove pin from response
      const { pin: _, ...memberData } = member.toJSON();

      res.status(201).json({
        success: true,
        message: 'Member created successfully',
        data: memberData
      });
    } catch (error) {
      console.error('Error creating member:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to create member',
        error: error.message
      });
    }
  },

  // PUT /members/:id - Update member
  async updateMember(req, res) {
    try {
      const { id } = req.params;
      const { email, username, pin, deposit } = req.body;

      const member = await Member.findByPk(id);
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found'
        });
      }

      // Validate deposit if provided
      if (deposit !== undefined && deposit < 0) {
        return res.status(400).json({
          success: false,
          message: 'Deposit amount cannot be negative'
        });
      }

      // Check if new email or username already exists (excluding current member)
      if (email || username) {
        const whereClause = {
          id: { [Op.ne]: id }
        };
        
        if (email && username) {
          whereClause[Op.or] = [{ email }, { username }];
        } else if (email) {
          whereClause.email = email;
        } else if (username) {
          whereClause.username = username;
        }

        const existingMember = await Member.findOne({ where: whereClause });
        if (existingMember) {
          return res.status(409).json({
            success: false,
            message: 'Email or username already exists'
          });
        }
      }

      // Prepare update data
      const updateData = {};
      if (email) updateData.email = email;
      if (username) updateData.username = username;
      if (pin) updateData.pin = await bcrypt.hash(pin, 10);
      if (deposit !== undefined) updateData.deposit = parseInt(deposit);

      await member.update(updateData);

      // Remove pin from response
      const { pin: _, ...memberData } = member.toJSON();

      res.status(200).json({
        success: true,
        message: 'Member updated successfully',
        data: memberData
      });
    } catch (error) {
      console.error('Error updating member:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to update member',
        error: error.message
      });
    }
  },

  // DELETE /members/:id - Delete member
  async deleteMember(req, res) {
    try {
      const { id } = req.params;

      const member = await Member.findByPk(id);
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found'
        });
      }

      // Check if member has transactions
      const transactionCount = await Transaction.count({
        where: { memberId: id }
      });

      if (transactionCount > 0) {
        return res.status(409).json({
          success: false,
          message: `Cannot delete member. Member has ${transactionCount} associated transactions.`,
          suggestion: 'Consider deactivating the member instead or remove associated transactions first.'
        });
      }

      await member.destroy();

      res.status(200).json({
        success: true,
        message: 'Member deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting member:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to delete member',
        error: error.message
      });
    }
  },

  // POST /members/:id/topup - Top up member deposit
  async topUpDeposit(req, res) {
    try {
      const { id } = req.params;
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Top up amount must be greater than 0'
        });
      }

      const member = await Member.findByPk(id);
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found'
        });
      }

      const newDeposit = parseInt(member.deposit) + parseInt(amount);
      await member.update({ deposit: newDeposit });

      // Remove pin from response
      const { pin: _, ...memberData } = member.toJSON();

      res.status(200).json({
        success: true,
        message: `Successfully topped up ${amount}. New deposit balance: ${newDeposit}`,
        data: {
          ...memberData,
          previousDeposit: member.deposit,
          topUpAmount: parseInt(amount),
          newDeposit: newDeposit
        }
      });
    } catch (error) {
      console.error('Error topping up deposit:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to top up deposit',
        error: error.message
      });
    }
  },

  // POST /members/:id/deduct - Deduct from member deposit
  async deductDeposit(req, res) {
    try {
      const { id } = req.params;
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Deduction amount must be greater than 0'
        });
      }

      const member = await Member.findByPk(id);
      if (!member) {
        return res.status(404).json({
          success: false,
          message: 'Member not found'
        });
      }

      const currentDeposit = parseInt(member.deposit);
      const deductAmount = parseInt(amount);

      if (currentDeposit < deductAmount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient deposit balance',
          data: {
            currentDeposit,
            requestedAmount: deductAmount,
            shortfall: deductAmount - currentDeposit
          }
        });
      }

      const newDeposit = currentDeposit - deductAmount;
      await member.update({ deposit: newDeposit });

      // Remove pin from response
      const { pin: _, ...memberData } = member.toJSON();

      res.status(200).json({
        success: true,
        message: `Successfully deducted ${deductAmount}. New deposit balance: ${newDeposit}`,
        data: {
          ...memberData,
          previousDeposit: currentDeposit,
          deductedAmount: deductAmount,
          newDeposit: newDeposit
        }
      });
    } catch (error) {
      console.error('Error deducting deposit:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to deduct deposit',
        error: error.message
      });
    }
  }
};

module.exports = memberController;
