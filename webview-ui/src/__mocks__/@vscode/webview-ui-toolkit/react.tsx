import React from "react"

export const VSCodeCheckbox = ({ children, onChange, checked, "data-testid": dataTestId, ...props }: any) => (
	<label data-testid={dataTestId}>
		<input type="checkbox" checked={checked} onChange={(e: any) => onChange?.(e)} {...props} />
		{children}
	</label>
)

export const VSCodeRadioGroup = ({ children, ...props }: any) => <div {...props}>{children}</div>

export const VSCodeRadio = ({ children, value, ...props }: any) => (
	<label>
		<input type="radio" value={value} {...props} />
		{children}
	</label>
)

export const VSCodeTextArea = ({ value, onChange, "data-testid": dataTestId, ...props }: any) => (
	<textarea data-testid={dataTestId} value={value} onChange={onChange} {...props} />
)

export const VSCodeLink = ({ children, href, ...props }: any) => (
	<a href={href} {...props}>
		{children}
	</a>
)

export const VSCodeTextField = ({ value, onInput, "data-testid": dataTestId, children, ...props }: any) => (
	<div>
		<input data-testid={dataTestId} value={value} onInput={onInput} {...props} />
		{children}
	</div>
)
