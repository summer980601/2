const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// 配置信息 - 将在Vercel中设置为环境变量
const APP_ID = process.env.APP_ID;
const APP_SECRET = process.env.APP_SECRET;
const BITABLE_APP_TOKEN = process.env.BITABLE_APP_TOKEN;
const BITABLE_TABLE_ID = process.env.BITABLE_TABLE_ID;

class AttendanceBot {
    constructor() {
        this.base_url = "https://open.feishu.cn/open-apis";
    }

    async getTenantAccessToken() {
        const url = `${this.base_url}/auth/v3/tenant_access_token/internal`;
        const data = {
            app_id: APP_ID,
            app_secret: APP_SECRET
        };
        
        try {
            const response = await axios.post(url, data);
            return response.data.tenant_access_token;
        } catch (error) {
            console.error('获取token失败:', error);
            return null;
        }
    }

    async getUserInfo(user_id, token) {
        const url = `${this.base_url}/contact/v3/users/${user_id}`;
        const headers = {
            'Authorization': `Bearer ${token}`
        };
        
        try {
            const response = await axios.get(url, { headers });
            return response.data;
        } catch (error) {
            console.error('获取用户信息失败:', error);
            return null;
        }
    }

    async addRecordToBitable(recordData, token) {
        const url = `${this.base_url}/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records`;
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
        
        const data = {
            records: [{ fields: recordData }]
        };
        
        try {
            const response = await axios.post(url, data, { headers });
            return response.data;
        } catch (error) {
            console.error('添加记录失败:', error);
            return null;
        }
    }

    async handleCheckIn(user_id, user_name) {
        const token = await this.getTenantAccessToken();
        const currentTime = new Date();
        
        // 判断是否迟到（9:30为上班时间）
        const checkInTime = new Date();
        checkInTime.setHours(9, 30, 0, 0);
        const status = currentTime > checkInTime ? "迟到" : "正常";
        
        const recordData = {
            "员工ID": user_id,
            "员工姓名": user_name,
            "打卡类型": "上班",
            "打卡时间": Math.floor(currentTime.getTime()),
            "状态": status
        };
        
        await this.addRecordToBitable(recordData, token);
        return `✅ ${user_name} 上班打卡成功！\n时间：${currentTime.toLocaleTimeString('zh-CN')}\n状态：${status}`;
    }

    async handleCheckOut(user_id, user_name) {
        const token = await this.getTenantAccessToken();
        const currentTime = new Date();
        
        // 判断是否早退（18:00为下班时间）
        const checkOutTime = new Date();
        checkOutTime.setHours(18, 0, 0, 0);
        const status = currentTime < checkOutTime ? "早退" : "正常";
        
        const recordData = {
            "员工ID": user_id,
            "员工姓名": user_name,
            "打卡类型": "下班",
            "打卡时间": Math.floor(currentTime.getTime()),
            "状态": status
        };
        
        await this.addRecordToBitable(recordData, token);
        return `✅ ${user_name} 下班打卡成功！\n时间：${currentTime.toLocaleTimeString('zh-CN')}\n状态：${status}`;
    }

    async handleOuting(user_id, user_name, reason = "外出办公") {
        const token = await this.getTenantAccessToken();
        const currentTime = new Date();
        
        const recordData = {
            "员工ID": user_id,
            "员工姓名": user_name,
            "打卡类型": "外出",
            "打卡时间": Math.floor(currentTime.getTime()),
            "外出事由": reason,
            "状态": "正常"
        };
        
        await this.addRecordToBitable(recordData, token);
        return `✅ ${user_name} 外出登记成功！\n时间：${currentTime.toLocaleTimeString('zh-CN')}\n事由：${reason}`;
    }

    getHelpMessage(user_name) {
        return `👋 你好 ${user_name}！欢迎使用考勤机器人

请使用以下口令进行操作：

🟢 基础打卡
• 上班打卡 - 记录上班时间
• 下班打卡 - 记录下班时间
• 外出打卡 [事由] - 记录外出，如：外出打卡 拜访客户

📊 查询功能  
• 我的考勤 - 查看个人今日考勤
• 今日考勤 - 管理员查看全员考勤

💡 提示：外出事由可选，默认"外出办公"`;
    }
}

const bot = new AttendanceBot();

// 处理飞书webhook
app.post('/api/attendance', async (req, res) => {
    const data = req.body;
    
    // URL验证
    if (data.type === "url_verification") {
        return res.json({ challenge: data.challenge });
    }
    
    // 处理消息
    if (data.type === "event_callback") {
        const event = data.event;
        if (event.message_type === "text") {
            const user_id = event.sender.sender_id.user_id;
            const messageContent = JSON.parse(event.message.content);
            const command = messageContent.text.trim();
            
            const token = await bot.getTenantAccessToken();
            const userInfo = await bot.getUserInfo(user_id, token);
            const user_name = userInfo?.data?.user?.name || "未知用户";
            
            let responseText;
            
            if (command === "上班打卡") {
                responseText = await bot.handleCheckIn(user_id, user_name);
            } else if (command === "下班打卡") {
                responseText = await bot.handleCheckOut(user_id, user_name);
            } else if (command.startsWith("外出打卡")) {
                const reason = command.length > 4 ? command.substring(4).trim() : "外出办公";
                responseText = await bot.handleOuting(user_id, user_name, reason);
            } else {
                responseText = bot.getHelpMessage(user_name);
            }
            
            // 回复消息
            const replyUrl = `${bot.base_url}/im/v1/messages`;
            const replyData = {
                receive_id: user_id,
                msg_type: "text",
                content: JSON.stringify({ text: responseText })
            };
            
            await axios.post(replyUrl, replyData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
        }
    }
    
    res.json({ status: "success" });
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Attendance Bot is running' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
