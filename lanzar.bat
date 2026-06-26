@echo off
title Lanzador de Prode Mundial 2026
cls

echo =======================================================
echo     BIENVENIDO AL PRODE DEL MUNDIAL DE AMIGOS
echo =======================================================
echo.

rem Verificar si Node.js está instalado
where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado en este sistema.
    echo Por favor, descarga e instala Node.js desde https://nodejs.org/
    echo.
    pause
    exit /b
)

rem Verificar si existe la carpeta node_modules, si no, instalar dependencias
if not exist node_modules (
    echo [INFO] No se encontro la carpeta 'node_modules'. Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Ocurrio un problema instalando las dependencias.
        pause
        exit /b
    )
)

echo [INFO] Iniciando el servidor del Prode...
echo.
echo [URL PC] Abriendo la aplicacion en tu navegador: http://localhost:3000
echo.
echo [URL CELULAR] Para acceder desde tu celular, conectate al mismo WiFi y entra a una de estas URLs:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do echo        - http://%%b:3000
)
echo.

rem Abrir navegador en segundo plano
start http://localhost:3000

rem Ejecutar el servidor
call npm start

pause
