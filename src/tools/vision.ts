import { Tool } from '../bus/toolbus.js';
import { NvidiaProvider } from '../providers/nvidia.js';

const DEFAULT_VISION_MODEL = 'meta/llama-3.2-11b-vision-instruct';

/**
 * Agent-callable image analysis. Sends an image (URL or data URI) plus a
 * question to a vision-capable NIM model and returns the description.
 */
export function createVisionTool(provider: NvidiaProvider, defaultModel = DEFAULT_VISION_MODEL): Tool {
  return {
    name: 'analyze_image',
    description:
      'Analyze/describe an image via a vision model. Pass an image URL (or data URI) and a question.',
    tags: ['vision', 'image', 'multimodal'],
    riskLevel: 'low',
    timeout: 60000,
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Image URL or data URI' },
        prompt: { type: 'string', description: 'What to ask about the image' },
        model: { type: 'string', description: 'Vision model to use (optional)' },
      },
      required: ['url'],
    },
    execute: async (args: { url: string; prompt?: string; model?: string }) => {
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: args.prompt || 'Describe this image in detail.' },
            { type: 'image_url', image_url: { url: args.url } },
          ],
        },
      ] as any;
      const answer = await provider.chat(messages, args.model || defaultModel);
      return { model: args.model || defaultModel, answer };
    },
  };
}
