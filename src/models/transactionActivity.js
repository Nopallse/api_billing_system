'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class TransactionActivity extends Model {
    static associate(models) {
      // Relasi dengan Transaction
      TransactionActivity.belongsTo(models.Transaction, {
        foreignKey: 'transactionId',
        as: 'transaction'
      });
    }
  }

  TransactionActivity.init({
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    transactionId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    activityType: {
      type: DataTypes.ENUM('start', 'stop', 'resume', 'add_time', 'end', 'ble_disconnect'),
      allowNull: false
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    durationAdded: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Duration added in seconds (for add_time activities)'
    },
    costAdded: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Cost added for additional time'
    },
    paymentMethod: {
      type: DataTypes.ENUM('deposit', 'cash', 'direct'),
      allowNull: true,
      comment: 'How the additional cost was paid'
    },
    previousBalance: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Member balance before this activity (if using deposit)'
    },
    newBalance: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Member balance after this activity (if using deposit)'
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    deviceStatus: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Device timer status at the time of activity'
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      comment: 'Additional metadata for the activity'
    }
  }, {
    sequelize,
    modelName: 'TransactionActivity',
    tableName: 'TransactionActivities'
  });

  return TransactionActivity;
};