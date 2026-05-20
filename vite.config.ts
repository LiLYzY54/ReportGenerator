import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';

export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    {
      name: 'html-to-docx-api',
      configureServer(server) {
        server.middlewares.use('/api/convert', async (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
                const { html, filename } = JSON.parse(body);
                const tempHtmlPath = path.join(process.cwd(), 'temp_report.html');
                const outputDocxPath = path.join(process.cwd(), 'temp_report.docx');
                
                fs.writeFileSync(tempHtmlPath, html);
                
                const scriptPath = path.join(process.cwd(), 'scripts', 'convert_to_docx.py');
                
                // Use --html and --output flags as expected by the script
                exec(`python3 "${scriptPath}" --html "${tempHtmlPath}" --output "${outputDocxPath}"`, (error, stdout, stderr) => {
                  if (error) {
                    console.error('Conversion error:', error, stderr);
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: error.message }));
                    return;
                  }
                  
                  if (!fs.existsSync(outputDocxPath)) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: 'Output file not generated' }));
                    return;
                  }

                  const docxBuffer = fs.readFileSync(outputDocxPath);
                  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                  res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent(filename)}.docx`);
                  res.end(docxBuffer);
                  
                  // Cleanup
                  try {
                    fs.unlinkSync(tempHtmlPath);
                    fs.unlinkSync(outputDocxPath);
                  } catch (e) {
                    console.error('Cleanup error:', e);
                  }
                });
              } catch (e: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: e.message }));
              }
            });
          } else {
            res.statusCode = 405;
            res.end();
          }
        });
      }
    }
  ],
  base: '/ReportGenerator/',
  server: {
    port: 5173,
    host: true
  }
});
