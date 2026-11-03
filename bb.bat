@echo off
setlocal
pushd "%~dp0" || exit /b 1

call pnpm clean || goto :done
call pnpm vsix || goto :done

set "vsixPath="
for /f "delims=" %%F in ('node -p "const p = require('.\\src\\package.json'); require('path').resolve('bin', p.name + '-' + p.version + '.vsix')"') do set "vsixPath=%%F"
if not defined vsixPath (
    echo Failed to read extension metadata from src\package.json. 1>&2
    set "exitCode=1"
    goto :exit
)

call code --force --install-extension "%vsixPath%"

:done
set "exitCode=%errorlevel%"

:exit
popd
exit /b %exitCode%
