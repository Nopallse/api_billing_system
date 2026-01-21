// WebSocket DISABLED - Stub functions
const getConnectionStatus = () => ({ devices: [], totalDevices: 0 });
const isTimerActive = () => false;
const { Device, Transaction, Category, User, Member, sequelize } = require('../models');
const { Op } = require('sequelize');

const dashboard = async (req, res) => {
    try {
        // Mendapatkan status koneksi dari semua perangkat
        const connectionStatus = getConnectionStatus();
        
        // Mendapatkan data device dari database
        const devices = await Device.findAll({
            include: [{
                model: Category,
                attributes: ['categoryName', 'cost', 'periode']
            }]
        });
        
        // Menghitung total device yang aktif dan tidak aktif
        const activeDevices = connectionStatus.devices.filter(device => device.status === 'on');
        const inactiveDevices = connectionStatus.devices.filter(device => device.status === 'off');
        
        // Mengambil detail device yang aktif dengan data dari database
        const activeDevicesDetail = await Promise.all(
            activeDevices.map(async (device) => {
                const deviceData = devices.find(d => d.id === device.deviceId);
                
                return {
                    device_id: deviceData?.id,
                    name: deviceData?.name,
                    category: deviceData?.Category?.categoryName,
                    category_cost: deviceData?.Category?.cost,
                    periode: deviceData?.Category?.periode,
                    status: device.status,
                    timer_start: deviceData?.timerStart,
                    timer_duration: deviceData?.timerDuration,
                    timer_elapsed: deviceData?.timerElapsed,
                    timer_status: deviceData?.timerStatus,
                    last_paused_at: deviceData?.lastPausedAt
                };
            })
        );

        // Mengambil 5 transaksi terakhir terlebih dahulu
        const lastTransactions = await Transaction.findAll({
            limit: 1,
            order: [['createdAt', 'DESC']],
            include: [{
                model: Device,
                include: [{
                    model: Category,
                    attributes: ['categoryName', 'cost', 'periode']
                }]
            }]
        });

        // Format data last used devices
        const lastUsedDevicesDetail = lastTransactions.map(transaction => ({
            device_id: transaction.Device?.id,
            name: transaction.Device?.name,
            category: transaction.Device?.Category?.categoryName,
            category_cost: transaction.Device?.Category?.cost,
            periode: transaction.Device?.Category?.periode,
            last_used: {
                start: transaction.start,
                end: transaction.end,
                duration: transaction.duration,
                cost: transaction.cost // Ini adalah harga transaksi, bukan harga kategori
            }
        })).filter(device => device.device_id); // Filter out null devices
        
        // Menyiapkan data untuk response
        const response = {
            summary: {
                total_active: activeDevices.length,
                total_inactive: inactiveDevices.length
            },
            active_devices: activeDevicesDetail,
            last_used_devices: lastUsedDevicesDetail
        };
        
        res.status(200).json(response);
    } catch (error) {
        console.error('Error in dashboard controller:', error);
        res.status(500).json({ message: error.message });
    }
}

const adminDashboard = async (req, res) => {
    try {
        // Mendapatkan filter waktu dari query parameter
        const timeFilter = req.query.timeFilter || 'week'; // Default: minggu ini
        const timeFilterText = {
            'week': 'Minggu ini',
            'month': 'Bulan ini',
            'year': 'Tahun ini'
        };
        
        // Mendapatkan status koneksi dari semua perangkat
        const connectionStatus = getConnectionStatus();
        
        // Mendapatkan data device dari database
        const devices = await Device.findAll({
            include: [{
                model: Category,
                attributes: ['categoryName', 'cost', 'periode']
            }]
        });
        
        // Menghitung status perangkat
        const activeDevices = connectionStatus.devices.filter(device => device.status === 'on');
        const readyDevices = connectionStatus.devices.filter(device => device.status === 'off');
        const totalDevices = devices.length;
        
        // Data profil admin dari user yang sedang login
        // Status berdasarkan isActive dari database (true = Aktif, false = Tidak Aktif)
        const adminUser = await User.findByPk(req.user.id, {
            attributes: ['id', 'email', 'username', 'isActive']
        });
        
        const adminProfile = {
            name: adminUser?.username || req.user.email.split('@')[0], // Username dari database atau email
            email: req.user.email,
            status: adminUser?.isActive ? "Aktif" : "Tidak Aktif",
            profile_picture: null // Tidak ada profile picture dari database
        };
        
        // Mendapatkan daftar perangkat yang sedang berjalan
        const runningDevicesList = await Promise.all(
            activeDevices.slice(0, 10).map(async (device, index) => {
                const deviceData = devices.find(d => d.id === device.deviceId);
                
                return {
                    no: index + 1,
                    nama_perangkat: deviceData?.name || `Device ${device.deviceId}`,
                    kategori: deviceData?.Category?.categoryName || 'Kategori 1'
                };
            })
        );
        
        // Menghitung total pemasukan berdasarkan filter waktu
        let startDate, endDate, chartData, totalIncome;
        
        if (timeFilter === 'week') {
            // Minggu ini
            startDate = new Date();
            startDate.setDate(startDate.getDate() - startDate.getDay() + 1); // Senin
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + 6); // Minggu
            endDate.setHours(23, 59, 59, 999);
            
            const weeklyTransactions = await Transaction.findAll({
                where: {
                    createdAt: {
                        [Op.between]: [startDate, endDate]
                    }
                },
                include: [{
                    model: Device,
                    include: [{
                        model: Category,
                        attributes: ['categoryName', 'cost', 'periode']
                    }]
                }]
            });
            
            // Menghitung pemasukan per hari
            const dailyIncome = {};
            const daysOfWeek = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];
            
            daysOfWeek.forEach(day => {
                dailyIncome[day] = 0;
            });
            
            weeklyTransactions.forEach(transaction => {
                const date = new Date(transaction.createdAt);
                const dayIndex = date.getDay();
                const dayName = daysOfWeek[dayIndex === 0 ? 6 : dayIndex - 1]; // Convert Sunday=0 to Sunday=6
                dailyIncome[dayName] += transaction.cost || 0;
            });
            
            chartData = daysOfWeek.map(day => ({
                day: day,
                income: dailyIncome[day]
            }));
            
            totalIncome = Object.values(dailyIncome).reduce((sum, income) => sum + income, 0);
            
        } else if (timeFilter === 'month') {
            // Bulan ini
            startDate = new Date();
            startDate.setDate(1); // Tanggal 1 bulan ini
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date();
            endDate.setMonth(endDate.getMonth() + 1, 0); // Tanggal terakhir bulan ini
            endDate.setHours(23, 59, 59, 999);
            
            const monthlyTransactions = await Transaction.findAll({
                where: {
                    createdAt: {
                        [Op.between]: [startDate, endDate]
                    }
                },
                include: [{
                    model: Device,
                    include: [{
                        model: Category,
                        attributes: ['categoryName', 'cost', 'periode']
                    }]
                }]
            });
            
            // Menghitung pemasukan per minggu dalam bulan
            const weeklyIncome = {};
            const weeksInMonth = Math.ceil((endDate.getDate() - startDate.getDate() + 1) / 7);
            
            for (let i = 1; i <= weeksInMonth; i++) {
                weeklyIncome[`Minggu ${i}`] = 0;
            }
            
            monthlyTransactions.forEach(transaction => {
                const date = new Date(transaction.createdAt);
                const weekNumber = Math.ceil((date.getDate() - 1) / 7) + 1;
                weeklyIncome[`Minggu ${weekNumber}`] += transaction.cost || 0;
            });
            
            chartData = Object.keys(weeklyIncome).map(week => ({
                day: week,
                income: weeklyIncome[week]
            }));
            
            totalIncome = Object.values(weeklyIncome).reduce((sum, income) => sum + income, 0);
            
        } else if (timeFilter === 'year') {
            // Tahun ini
            startDate = new Date();
            startDate.setMonth(0, 1); // 1 Januari tahun ini
            startDate.setHours(0, 0, 0, 0);
            
            endDate = new Date();
            endDate.setMonth(11, 31); // 31 Desember tahun ini
            endDate.setHours(23, 59, 59, 999);
            
            const yearlyTransactions = await Transaction.findAll({
                where: {
                    createdAt: {
                        [Op.between]: [startDate, endDate]
                    }
                },
                include: [{
                    model: Device,
                    include: [{
                        model: Category,
                        attributes: ['categoryName', 'cost', 'periode']
                    }]
                }]
            });
            
            // Menghitung pemasukan per bulan
            const monthlyIncome = {};
            const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                           'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
            
            months.forEach(month => {
                monthlyIncome[month] = 0;
            });
            
            yearlyTransactions.forEach(transaction => {
                const date = new Date(transaction.createdAt);
                const monthIndex = date.getMonth();
                monthlyIncome[months[monthIndex]] += transaction.cost || 0;
            });
            
            chartData = months.map(month => ({
                day: month,
                income: monthlyIncome[month]
            }));
            
            totalIncome = Object.values(monthlyIncome).reduce((sum, income) => sum + income, 0);
        }
        
        // Mendapatkan daftar user terdaftar (6 user teratas sesuai dashboard)
        const registeredUsers = await User.findAll({
            limit: 6,
            order: [['createdAt', 'DESC']],
            attributes: ['id', 'email', 'type', 'isActive', 'createdAt']
        });
        
        // Format data user untuk response
        // Status berdasarkan isActive dari database (true = Aktif, false = Tidak Aktif)
        const usersList = registeredUsers.map((user, index) => ({
            no: index + 1,
            email: user.email,
            nama: user.email.split('@')[0], // Menggunakan username dari email
            status: user.isActive ? "Aktif" : "Tidak Aktif"
        }));
        
        // Quick Stats - Calculate today's data
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);
        
        // Today's income and transaction count
        const todayTransactions = await Transaction.findAll({
            where: {
                createdAt: {
                    [Op.between]: [todayStart, todayEnd]
                }
            }
        });
        
        const todayIncome = todayTransactions.reduce((sum, t) => sum + (t.cost || 0), 0);
        const todayTransactionCount = todayTransactions.length;
        
        // Total counts
        const totalMembers = await Member.count();
        const totalUsers = await User.count();
        
        // Period transaction count (based on selected filter)
        let periodTransactionCount = 0;
        if (timeFilter === 'week') {
            periodTransactionCount = await Transaction.count({
                where: {
                    createdAt: {
                        [Op.between]: [startDate, endDate]
                    }
                }
            });
        } else if (timeFilter === 'month') {
            periodTransactionCount = await Transaction.count({
                where: {
                    createdAt: {
                        [Op.between]: [startDate, endDate]
                    }
                }
            });
        } else if (timeFilter === 'year') {
            periodTransactionCount = await Transaction.count({
                where: {
                    createdAt: {
                        [Op.between]: [startDate, endDate]
                    }
                }
            });
        }
        
        // Menyiapkan data untuk response
        const response = {
            admin_profile: adminProfile,
            device_status: {
                running: {
                    text: "Perangkat sedang berjalan",
                    value: `${activeDevices.length}/${totalDevices}`
                },
                ready: {
                    text: "Perangkat siap digunakan", 
                    value: `${readyDevices.length}/${totalDevices}`
                }
            },
            running_devices_list: {
                title: "Daftar Perangkat Sedang Berjalan",
                devices: runningDevicesList,
                total_count: activeDevices.length
            },
            total_income: {
                title: "Total pemasukan",
                timeframe: timeFilterText[timeFilter],
                total: totalIncome,
                chart_data: chartData,
                available_filters: [
                    { value: 'week', label: 'Minggu ini' },
                    { value: 'month', label: 'Bulan ini' },
                    { value: 'year', label: 'Tahun ini' }
                ]
            },
            registered_users: {
                title: "User yang terdaftar",
                users: usersList,
                total_count: totalUsers
            },
            quick_stats: {
                today_income: todayIncome,
                today_transactions: todayTransactionCount,
                period_transactions: periodTransactionCount,
                total_members: totalMembers,
                total_devices: totalDevices,
                total_users: totalUsers
            }
        };
        
        res.status(200).json(response);
    } catch (error) {
        console.error('Error in admin dashboard controller:', error);
        res.status(500).json({ message: error.message });
    }
}

module.exports = { dashboard, adminDashboard };