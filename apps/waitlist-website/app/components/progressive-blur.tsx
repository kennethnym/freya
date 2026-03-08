export function ProgressiveBlur({ className }: { className?: string }) {
	return (
		<div className={`pointer-events-none ${className ?? ""}`}>
			<div className="absolute inset-0 backdrop-blur-[64px] [mask:linear-gradient(rgba(0,0,0,1)_0%,rgba(0,0,0,1)_20%,rgba(0,0,0,0)_30%)]" />
			<div className="absolute inset-0 backdrop-blur-[32px] [mask:linear-gradient(rgba(0,0,0,0)_10%,rgba(0,0,0,1)_20%,rgba(0,0,0,1)_40%,rgba(0,0,0,0)_50%)]" />
			<div className="absolute inset-0 backdrop-blur-[16px] [mask:linear-gradient(rgba(0,0,0,0)_20%,rgba(0,0,0,1)_30%,rgba(0,0,0,1)_50%,rgba(0,0,0,0)_60%)]" />
			<div className="absolute inset-0 backdrop-blur-[8px] [mask:linear-gradient(rgba(0,0,0,0)_30%,rgba(0,0,0,1)_40%,rgba(0,0,0,1)_60%,rgba(0,0,0,0)_70%)]" />
			<div className="absolute inset-0 backdrop-blur-[4px] [mask:linear-gradient(rgba(0,0,0,0)_40%,rgba(0,0,0,1)_50%,rgba(0,0,0,1)_70%,rgba(0,0,0,0)_80%)]" />
			<div className="absolute inset-0 backdrop-blur-[2px] [mask:linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,1)_60%,rgba(0,0,0,1)_80%,rgba(0,0,0,0)_90%)]" />
			<div className="absolute inset-0 backdrop-blur-[1px] [mask:linear-gradient(rgba(0,0,0,0)_70%,rgba(0,0,0,1)_80%,rgba(0,0,0,1)_90%,rgba(0,0,0,0)_100%)]" />
			<div className="absolute inset-0 bg-linear-to-b from-stone-50 dark:from-stone-900 to-transparent" />
		</div>
	)
}
