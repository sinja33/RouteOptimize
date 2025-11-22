from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OSRM_URL: str = "http://osrm:5000"
    VROOM_URL: str = "http://vroom:3000"
    GOOGLE_API_KEY: str = ""

# Instantiate settings
settings = Settings()
