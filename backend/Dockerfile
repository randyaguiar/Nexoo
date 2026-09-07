# Build
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Nexoo.Api/Nexoo.Api.csproj Nexoo.Api/
RUN dotnet restore Nexoo.Api/Nexoo.Api.csproj
COPY . .
RUN dotnet publish Nexoo.Api/Nexoo.Api.csproj -c Release -o /app

# Runtime
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
COPY --from=build /app .

# Render/Railway/Fly inject PORT; default to 8080 for local `docker run`.
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "Nexoo.Api.dll"]
