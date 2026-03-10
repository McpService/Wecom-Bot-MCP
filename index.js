#!/usr/bin/env node

/**
 * @fileoverview 企业微信机器人 MCP 服务器主入口
 * @description 基于 @modelcontextprotocol/sdk 实现的企业微信机器人服务
 *
 * 功能特性：
 * - send_message: 发送 Markdown V2 格式消息
 * - send_file: 发送文件
 * - send_image: 发送图片
 *
 * @example
 * // 直接运行
 * node index.js
 *
 * // Claude Desktop 配置
 * {
 *   "mcpServers": {
 *     "wecom-robot": {
 *       "command": "node",
 *       "args": ["/path/to/WeComRobot/index.js"]
 *     }
 *   }
 * }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { WeComClient, WeComError } from './src/wecom-client.js';

/**
 * 从环境变量读取企业微信机器人配置
 */
const WECOM_WEBHOOK_KEY = process.env.WECOM_WEBHOOK_KEY || null;

/**
 * 服务器元信息
 */
const SERVER_INFO = {
  name: 'wecom-robot-mcp',
  version: '2.0.0',
  description: '企业微信机器人 MCP 服务，支持发送消息、文件和图片'
};

/**
 * 获取有效的 webhook key
 *
 * 优先级：调用时提供的 key > 环境变量配置的 key
 *
 * @param {string} [providedKey] - 调用时提供的 webhook key
 * @returns {string} webhook key
 * @throws {WeComError} 当未提供 key 且环境变量也未配置时
 */
function getWebhookKey(providedKey) {
  const key = providedKey || WECOM_WEBHOOK_KEY;

  if (!key) {
    throw new WeComError(
      -1,
      '未提供 webhook_key 参数，且未设置 WECOM_WEBHOOK_KEY 环境变量'
    );
  }

  return key;
}

/**
 * 记录日志到标准错误
 *
 * 使用 stderr 避免干扰 stdout 的 MCP 通信
 *
 * @param {string} message - 日志消息
 */
function log(message) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] ${message}\n`);
}

/**
 * 创建 MCP 服务器并注册工具
 *
 * @returns {McpServer} MCP 服务器实例
 */
function createServer() {
  const server = new McpServer(SERVER_INFO);

  // 注册发送消息工具
  server.registerTool('send_message', {
    title: '发送 Markdown 消息',
    description: '发送 Markdown V2 格式的消息到企业微信机器人。支持标题、加粗、斜体、列表、引用、链接、代码块、表格等语法。内容最大 4096 字节。如果配置了 WECOM_WEBHOOK_KEY 环境变量，webhook_key 参数可选。',
    inputSchema: {
      webhook_key: z
        .string()
        .optional()
        .describe('企业微信机器人的 webhook key。如果未设置 WECOM_WEBHOOK_KEY 环境变量，则此参数必填。'),
      content: z
        .string()
        .describe('Markdown V2 格式的消息内容。支持语法：# 标题、**加粗**、*斜体*、- 列表、> 引用、[链接](url)、`代码`、```代码块```、|表格| 等')
    }
  }, async ({ webhook_key, content }) => {
    try {
      const key = getWebhookKey(webhook_key);

      if (!content || typeof content !== 'string') {
        throw new WeComError(-1, 'content 参数不能为空且必须是字符串');
      }

      const client = new WeComClient(key);
      const result = await client.sendMarkdownV2(content);

      log(`消息发送成功：${JSON.stringify(result)}`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      log(`消息发送失败：${error.message}`);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.name || 'Error',
              message: error.message,
              code: error.code
            }, null, 2)
          }
        ]
      };
    }
  });

  // 注册发送文件工具
  server.registerTool('send_file', {
    title: '发送文件',
    description: '发送文件到企业微信机器人。先上传文件到企业微信服务器，然后发送文件消息。支持 PDF、Word、Excel、PPT、TXT、ZIP 等格式，最大 20MB。如果配置了 WECOM_WEBHOOK_KEY 环境变量，webhook_key 参数可选。',
    inputSchema: {
      webhook_key: z
        .string()
        .optional()
        .describe('企业微信机器人的 webhook key。如果未设置 WECOM_WEBHOOK_KEY 环境变量，则此参数必填。'),
      file_path: z
        .string()
        .describe('本地文件的绝对路径或相对路径（例如：/path/to/document.pdf 或 ./files/report.xlsx）')
    }
  }, async ({ webhook_key, file_path }) => {
    try {
      const key = getWebhookKey(webhook_key);

      if (!file_path || typeof file_path !== 'string') {
        throw new WeComError(-1, 'file_path 参数不能为空且必须是字符串');
      }

      const client = new WeComClient(key);

      // 先上传文件
      const uploadResult = await client.uploadMedia(file_path, 'file');
      log(`文件上传成功，media_id: ${uploadResult.media_id}`);

      // 然后发送文件消息
      const sendResult = await client.sendFile(uploadResult.media_id);
      log(`文件消息发送成功`);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              upload: uploadResult,
              send: sendResult
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      log(`文件发送失败：${error.message}`);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.name || 'Error',
              message: error.message,
              code: error.code
            }, null, 2)
          }
        ]
      };
    }
  });

  // 注册发送图片工具
  server.registerTool('send_image', {
    title: '发送图片',
    description: '发送图片到企业微信机器人。支持本地图片文件路径或网络图片 URL。仅支持 JPG 和 PNG 格式，最大 2MB。如果配置了 WECOM_WEBHOOK_KEY 环境变量，webhook_key 参数可选。',
    inputSchema: {
      webhook_key: z
        .string()
        .optional()
        .describe('企业微信机器人的 webhook key。如果未设置 WECOM_WEBHOOK_KEY 环境变量，则此参数必填。'),
      image_path: z
        .string()
        .optional()
        .describe('本地图片文件的路径（可选，与 image_url 二选一）'),
      image_url: z
        .string()
        .optional()
        .describe('网络图片的 URL 地址（可选，与 image_path 二选一）')
    }
  }, async ({ webhook_key, image_path, image_url }) => {
    try {
      const key = getWebhookKey(webhook_key);

      // 验证参数：必须提供 image_path 或 image_url 之一
      if (!image_path && !image_url) {
        throw new WeComError(-1, '必须提供 image_path 或 image_url 参数');
      }

      // 验证不能同时提供两个参数
      if (image_path && image_url) {
        throw new WeComError(-1, 'image_path 和 image_url 只能提供一个');
      }

      const client = new WeComClient(key);
      let result;

      if (image_path) {
        result = await client.sendImage(image_path);
        log(`本地图片发送成功：${image_path}`);
      } else if (image_url) {
        result = await client.sendImageFromUrl(image_url);
        log(`网络图片发送成功：${image_url}`);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    } catch (error) {
      log(`图片发送失败：${error.message}`);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: error.name || 'Error',
              message: error.message,
              code: error.code
            }, null, 2)
          }
        ]
      };
    }
  });

  return server;
}

/**
 * 主入口函数
 */
async function main() {
  // 启动时检查环境变量
  if (!WECOM_WEBHOOK_KEY) {
    log('警告：未设置 WECOM_WEBHOOK_KEY 环境变量，调用工具时必须提供 webhook_key 参数');
  } else {
    // 脱敏显示 webhook key（仅显示首尾各 8 位）
    const keyLength = WECOM_WEBHOOK_KEY.length;
    const maskedKey = keyLength > 16
      ? `${WECOM_WEBHOOK_KEY.substring(0, 8)}...${WECOM_WEBHOOK_KEY.substring(keyLength - 8)}`
      : '***';
    log(`已配置 WECOM_WEBHOOK_KEY: ${maskedKey}`);
  }

  try {
    // 创建服务器
    const server = createServer();

    // 创建标准输入输出传输
    const transport = new StdioServerTransport();

    // 连接服务器到传输
    await server.connect(transport);

    log('MCP 服务器已启动，等待请求...');
  } catch (error) {
    log(`服务器启动失败：${error.message}`);
    console.error('Server error:', error);
    process.exit(1);
  }
}

// 运行主入口
main();
