'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('TransactionActivities', {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4
      },
      transactionId: {
        type: Sequelize.UUID,
        allowNull: false,
        references: {
          model: 'Transactions',
          key: 'id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      activityType: {
        type: Sequelize.ENUM('start', 'stop', 'resume', 'add_time', 'end'),
        allowNull: false
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      durationAdded: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Duration added in seconds (for add_time activities)'
      },
      costAdded: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Cost added for additional time'
      },
      paymentMethod: {
        type: Sequelize.ENUM('deposit', 'cash', 'direct'),
        allowNull: true,
        comment: 'How the additional cost was paid'
      },
      previousBalance: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Member balance before this activity (if using deposit)'
      },
      newBalance: {
        type: Sequelize.INTEGER,
        allowNull: true,
        comment: 'Member balance after this activity (if using deposit)'
      },
      timestamp: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.NOW
      },
      deviceStatus: {
        type: Sequelize.STRING,
        allowNull: true,
        comment: 'Device timer status at the time of activity'
      },
      metadata: {
        type: Sequelize.JSON,
        allowNull: true,
        comment: 'Additional metadata for the activity'
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });

    // Add indexes
    await queryInterface.addIndex('TransactionActivities', ['transactionId']);
    await queryInterface.addIndex('TransactionActivities', ['activityType']);
    await queryInterface.addIndex('TransactionActivities', ['timestamp']);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('TransactionActivities');
  }
};