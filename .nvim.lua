local ok, conform = pcall(require, "conform")
if not ok then
	vim.notify("conform.nvim not loaded", vim.log.levels.WARN)
	return
end

conform.setup({
	formatters_by_ft = {
		javascript = { "oxfmt" },
		javascriptreact = { "oxfmt" },
		typescript = { "oxfmt" },
		typescriptreact = { "oxfmt" },
		json = { "oxfmt" },
		jsonc = { "oxfmt" },
	},
})

vim.lsp.enable("tsgo")
vim.lsp.enable("oxlint")
